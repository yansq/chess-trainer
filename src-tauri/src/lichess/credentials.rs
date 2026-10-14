const SERVICE: &str = "com.yansiqi.chesstrainer.lichess";
pub fn save(username: &str, token: &str) -> Result<(), String> {
    if username.trim().is_empty() {
        return Err("请先填写用户名".into());
    }
    if token.is_empty() {
        security_framework::passwords::delete_generic_password(SERVICE, username)
            .map_err(|e| e.to_string())
    } else {
        security_framework::passwords::set_generic_password(SERVICE, username, token.as_bytes())
            .map_err(|e| e.to_string())
    }
}
pub fn load(username: &str) -> Option<String> {
    security_framework::passwords::get_generic_password(SERVICE, username)
        .ok()
        .and_then(|b| String::from_utf8(b).ok())
}
