use std::{
    io::Read,
    process::{Command, Output, Stdio},
    time::{Duration, Instant},
};

/// Drain both pipes while waiting; native OCR may exceed the OS pipe buffer.
pub fn run(
    command: &mut Command,
    timeout: Duration,
    context: &str,
) -> crate::error::Result<Output> {
    use crate::error::AppError;
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|e| AppError::Unknown(format!("{context}: {e}")))?;
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let out = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).map(|_| bytes)
    });
    let err = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes).map(|_| bytes)
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(50))
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(AppError::Unknown(format!("{context}: timed out")));
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(AppError::Io(error));
            }
        }
    };
    let stdout = out
        .join()
        .map_err(|_| AppError::Unknown("stdout reader failed".into()))??;
    let stderr = err
        .join()
        .map_err(|_| AppError::Unknown("stderr reader failed".into()))??;
    Ok(Output {
        status: status?,
        stdout,
        stderr,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_command_output_can_exceed_a_pipe_buffer() {
        #[cfg(windows)]
        let mut command = {
            let mut c = Command::new(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe");
            c.args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Write-Output ('x' * 20000)",
            ]);
            c
        };
        #[cfg(target_os = "macos")]
        let mut command = {
            let mut c = Command::new("/bin/sh");
            c.args(["-c", "yes x | head -c 20000"]);
            c
        };
        let output = run(&mut command, Duration::from_secs(10), "pipe test").unwrap();
        assert!(output.stdout.len() >= 20000);
    }
}
