//! Check a published update and install into an expendable .app inside the system temp directory.
//! Never launches the application or opens its real database.
use std::{path::PathBuf, process::Command};
use tauri_plugin_updater::UpdaterExt;

fn app_version(app: &std::path::Path) -> Result<String, String> {
    let output = Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Print :CFBundleShortVersionString"])
        .arg(app.join("Contents/Info.plist"))
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("Cannot read app version".into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}
fn main() {
    let path = PathBuf::from(
        std::env::args()
            .nth(1)
            .expect("Pass an expendable .app path in the system temp directory"),
    );
    let path = path.canonicalize().expect("Test app must exist");
    let temp = std::env::temp_dir().canonicalize().unwrap();
    assert!(
        path.starts_with(&temp) || path.starts_with("/private/tmp/"),
        "Refusing to replace app outside temporary directories"
    );
    assert_eq!(path.extension().and_then(|s| s.to_str()), Some("app"));
    let local_manifest = std::env::args().nth(2).map(PathBuf::from);
    let before = app_version(&path).unwrap();
    let executable = path.join("Contents/MacOS/chess-trainer");
    assert!(executable.is_file());
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.package_info_mut().version = before.parse().unwrap();
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let handle = app.handle().clone();
            let path = path.clone();
            let executable = executable.clone();
            let before = before.clone();
            let local_manifest = local_manifest.clone();
            tauri::async_runtime::spawn(async move {
                let result: Result<(), String> = async {
                    let updater = handle.updater_builder().executable_path(executable).build().map_err(|e| e.to_string())?;
                    let (update, local_bytes) = if let Some(manifest) = local_manifest {
                        let raw: serde_json::Value = serde_json::from_slice(&std::fs::read(&manifest).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
                        let url = raw["platforms"]["darwin-aarch64"]["url"].as_str().ok_or("Missing package URL")?;
                        let filename = url.rsplit('/').next().ok_or("Missing filename")?;
                        let bytes = std::fs::read(manifest.parent().unwrap().join(filename)).map_err(|e| e.to_string())?;
                        (updater.restore_update(raw).map_err(|e| e.to_string())?.ok_or("No newer local version")?, Some(bytes))
                    } else {
                        (updater.check().await.map_err(|e| e.to_string())?.ok_or("No newer published version")?, None)
                    };
                    println!("Update: {before} -> {}", update.version);
                    let bytes = if let Some(bytes) = local_bytes { update.verify(&bytes).map_err(|e| e.to_string())?; bytes } else { update.download(|_, _| {}, || {}).await.map_err(|e| e.to_string())? };
                    let mut tampered = bytes.clone();
                    tampered[0] ^= 1;
                    if update.verify(&tampered).is_ok() { return Err("Tampered package was accepted".into()); }
                    println!("Downloaded {} bytes; original signature valid; tampered package rejected", bytes.len());
                    update.install(&bytes).map_err(|e| e.to_string())?;
                    let installed = app_version(&path)?;
                    if installed != update.version { return Err(format!("Installed version mismatch: {installed}")); }
                    let status = Command::new("codesign").args(["--verify", "--deep", "--strict"]).arg(&path).status().map_err(|e| e.to_string())?;
                    if !status.success() { return Err("Installed app signature invalid".into()); }
                    println!("Installed {installed} into temporary app; macOS code signature valid; real user data untouched");
                    Ok(())
                }.await;
                match result { Ok(()) => handle.exit(0), Err(error) => { eprintln!("Updater verification failed: {error}"); handle.exit(1); } }
            });
            Ok(())
        })
        .run(context).expect("Updater verification app failed");
}
