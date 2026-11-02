#[path = "../src/chesscom.rs"]
mod chesscom;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    chesscom::test_connection("hikaru").await.unwrap();
    let archives = chesscom::archives("hikaru").await.unwrap();
    assert!(archives.contains(&"2025/02".to_owned()));
    let games = chesscom::month("hikaru", "2025/02").await.unwrap();
    assert!(!games.is_empty());
    assert!(games.iter().any(|g| g.rules == "chess"
        && chesscom::game_id(&g.url).is_some()
        && chesscom::pgn_game_id(&g.pgn) == chesscom::game_id(&g.url)));
    println!("Chess.com live API verified: account, {} archives, {} monthly games; native client and identities valid",archives.len(),games.len());
}
