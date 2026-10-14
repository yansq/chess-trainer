pub fn is_bot_game(pgn: &str, white: &str, black: &str) -> bool {
    // Lichess computer games use these names even when no BOT title is present.
    let is_ai_name = |name: &str| {
        let name = name.trim().to_ascii_lowercase();
        ["stockfish level ", "lichess ai level "]
            .iter()
            .any(|prefix| {
                name.strip_prefix(prefix).is_some_and(|level| {
                    matches!(level, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8")
                })
            })
    };
    if is_ai_name(white) || is_ai_name(black) {
        return true;
    }
    for line in pgn.trim_start_matches('\u{feff}').trim_start().lines() {
        let line = line.trim();
        let Some(tag) = line.strip_prefix('[').and_then(|s| s.strip_suffix(']')) else {
            break;
        };
        let Some((key, value)) = tag.split_once(char::is_whitespace) else {
            continue;
        };
        let value = value.trim().trim_matches('"');
        if (matches!(key, "WhiteTitle" | "BlackTitle") && value.eq_ignore_ascii_case("BOT"))
            || (matches!(key, "WhiteType" | "BlackType") && value.eq_ignore_ascii_case("program"))
        {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_bot_titles_and_computer_players_without_guessing_usernames() {
        for tag in ["WhiteTitle", "BlackTitle"] {
            assert!(is_bot_game(
                &format!("[Event \"Casual game\"]\r\n[{tag} \"BOT\"]\r\n\r\n1. e4"),
                "Trainer",
                "Engine"
            ));
        }
        assert!(is_bot_game("[WhiteType \"program\"]", "Engine", "Trainer"));
        assert!(is_bot_game("[BlackType \"program\"]", "Trainer", "Engine"));
        assert!(is_bot_game("", "Trainer", "Stockfish level 8"));
        assert!(is_bot_game("", "lichess AI level 1", "Trainer"));
        assert!(!is_bot_game(
            "[WhiteTitle \"GM\"]",
            "RobotFan",
            "StockfishFan"
        ));
        assert!(!is_bot_game(
            "[Event \"Casual game\"]\n\n1. e4 { [BlackTitle \"BOT\"] }",
            "Trainer",
            "Opponent"
        ));
    }
}
