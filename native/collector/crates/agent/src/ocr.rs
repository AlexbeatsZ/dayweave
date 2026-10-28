use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::{Command, Output};
use std::time::Duration;
const OCR_COMMAND_TIMEOUT: Duration = Duration::from_secs(20);
/// OCR 结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrResult {
    pub text: String,
    pub confidence: f32,
    pub boxes: Vec<OcrBox>,
}

/// OCR 文字框
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrBox {
    pub text: String,
    pub confidence: f32,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

pub struct OcrService;
impl OcrService {
    pub fn new() -> Self {
        Self
    }
    pub fn extract_text(&self, path: &Path) -> Result<Option<OcrResult>> {
        #[cfg(windows)]
        {
            self.extract_with_windows_ocr(path)
        }
        #[cfg(target_os = "macos")]
        {
            self.extract_with_vision(path)
        }
    }
    fn run_command_with_timeout(command: &mut Command, context: &str) -> Result<Output> {
        crate::command::run(command, OCR_COMMAND_TIMEOUT, context)
    }

    /// 使用 Windows OCR API (通过 PowerShell)
    #[cfg(target_os = "windows")]
    fn extract_with_windows_ocr(&self, image_path: &Path) -> Result<Option<OcrResult>> {
        use std::os::windows::process::CommandExt;
        use std::path::PathBuf;
        use std::time::{SystemTime, UNIX_EPOCH};

        // CREATE_NO_WINDOW 标志，防止弹出黑色控制台窗口
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let powershell_path =
            PathBuf::from(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe");

        let script = format!(
            r#"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$imagePath = '{}'

function Write-OcrJson($payload) {{
    Write-Output (ConvertTo-Json $payload -Depth 5 -Compress)
}}

function Write-OcrError([string]$message) {{
    Write-OcrJson @{{
        text = ""
        error = ([string]$message)
        boxes = @()
        confidence = 0
    }}
}}

# 加载 Windows.Media.Ocr
[Windows.Media.Ocr.OcrEngine, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime] | Out-Null
[Windows.Globalization.Language, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime] | Out-Null
[Windows.System.UserProfile.GlobalizationPreferences, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime] | Out-Null

# 辅助函数：等待异步操作完成
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {{ $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' }})[0]
if ($null -eq $asTaskGeneric) {{
    Write-OcrError "System.WindowsRuntimeSystemExtensions.AsTask 未找到"
    exit
}}

Function Await($WinRtTask, $ResultType) {{
    if ($null -eq $WinRtTask) {{
        throw "WinRT 异步任务为空: $ResultType"
    }}
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
}}

try {{
    # 打开图片文件
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($imagePath)) ([Windows.Storage.StorageFile])
    if ($null -eq $file) {{
        throw "读取截图文件失败: $imagePath"
    }}
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    if ($null -eq $stream) {{
        throw "打开截图流失败: $imagePath"
    }}

    # 解码图片
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    if ($null -eq $bitmap) {{
        throw "解码截图失败: $imagePath"
    }}
    $ocrBitmap = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert(
        $bitmap,
        [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
        [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied
    )
    if ($null -eq $ocrBitmap) {{
        throw "转换 OCR 位图失败: $imagePath"
    }}

    # 创建 OCR 引擎 (优先用户语言，其次简中/英文)
    $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($ocrEngine -eq $null) {{
        foreach ($langTag in @('zh-Hans', 'zh-Hans-CN', 'en-US')) {{
            try {{
                $language = [Windows.Globalization.Language]::new($langTag)
                $candidate = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
                if ($candidate -ne $null) {{
                    $ocrEngine = $candidate
                    break
                }}
            }} catch {{
            }}
        }}
    }}

    if ($ocrEngine -eq $null) {{
        $profileLanguages = [string]::Join(',', [Windows.System.UserProfile.GlobalizationPreferences]::Languages)
        Write-OcrError ("No OCR engine available; user profile languages=" + ([string]$profileLanguages))
        exit
    }}

    # 执行 OCR
    $result = Await ($ocrEngine.RecognizeAsync($ocrBitmap)) ([Windows.Media.Ocr.OcrResult])
    if ($null -eq $result) {{
        throw "OCR 结果为空"
    }}

    $allText = @()
    $boxes = @()

    foreach ($line in $result.Lines) {{
        $allText += $line.Text
        foreach ($word in $line.Words) {{
            $rect = $word.BoundingRect
            $boxes += @{{
                text = $word.Text
                confidence = 0.9
                x = [int]$rect.X
                y = [int]$rect.Y
                width = [int]$rect.Width
                height = [int]$rect.Height
            }}
        }}
    }}

    $output = @{{
        text = ($allText -join "`n")
        boxes = $boxes
        confidence = 0.9
    }}

    Write-OcrJson $output

    try {{ $stream.Dispose() }} catch {{}}
    try {{ $bitmap.Dispose() }} catch {{}}
    try {{ $ocrBitmap.Dispose() }} catch {{}}
}} catch {{
    $message = if ($_.Exception -and $_.Exception.Message) {{
        [string]$_.Exception.Message
    }} else {{
        [string]$_
    }}
    Write-OcrError $message
}}
"#,
            image_path.to_string_lossy().replace("'", "''")
        );

        let script_name = format!(
            "work_review_ocr_{}.ps1",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let temporary = work_review_core::config::temporary_directory();
        std::fs::create_dir_all(&temporary)?;
        let script_path = temporary.join(script_name);

        // 写入时添加 UTF-8 BOM，确保 Windows PowerShell 正确识别编码
        let bom: &[u8] = b"\xEF\xBB\xBF";
        let script_bytes = script.as_bytes();
        let mut content = Vec::with_capacity(bom.len() + script_bytes.len());
        content.extend_from_slice(bom);
        content.extend_from_slice(script_bytes);

        if let Err(e) = std::fs::write(&script_path, &content) {
            log::warn!("写入 Windows OCR 临时脚本失败: {e}");
            return Ok(None);
        }

        let output = Self::run_command_with_timeout(
            Command::new(&powershell_path)
                .args([
                    "-NoProfile",
                    "-Sta",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    script_path.to_string_lossy().as_ref(),
                ])
                .creation_flags(CREATE_NO_WINDOW),
            "Windows OCR",
        );

        let _ = std::fs::remove_file(&script_path);

        match output {
            Ok(result) if result.status.success() => {
                let stdout = String::from_utf8_lossy(&result.stdout);
                let stderr = String::from_utf8_lossy(&result.stderr);

                if let Ok(ocr_output) = serde_json::from_str::<serde_json::Value>(&stdout) {
                    if let Some(error) = ocr_output.get("error").and_then(|v| v.as_str()) {
                        log::warn!("Windows OCR 错误: {error}");
                        if !stderr.trim().is_empty() {
                            log::warn!("Windows OCR stderr: {}", stderr.trim());
                        }
                        return Ok(None);
                    }

                    let text = ocr_output
                        .get("text")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    if text.is_empty() {
                        return Ok(None);
                    }

                    let confidence = ocr_output
                        .get("confidence")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.9) as f32;

                    let boxes: Vec<OcrBox> = ocr_output
                        .get("boxes")
                        .and_then(|v| serde_json::from_value(v.clone()).ok())
                        .unwrap_or_default();

                    log::debug!("Windows OCR 识别到 {} 个字符", text.len());

                    Ok(Some(OcrResult {
                        text,
                        confidence,
                        boxes,
                    }))
                } else {
                    if !stdout.trim().is_empty() {
                        log::warn!("Windows OCR 输出无法解析为 JSON: {}", stdout.trim());
                    }
                    if !stderr.trim().is_empty() {
                        log::warn!("Windows OCR stderr: {}", stderr.trim());
                    }
                    Ok(None)
                }
            }
            Ok(result) => {
                let stderr = String::from_utf8_lossy(&result.stderr);
                let stdout = String::from_utf8_lossy(&result.stdout);
                log::warn!(
                    "Windows OCR PowerShell 执行失败: status={:?}, stderr={}, stdout={}",
                    result.status.code(),
                    stderr.trim(),
                    stdout.trim()
                );
                Ok(None)
            }
            Err(e) => {
                log::warn!("Windows OCR PowerShell 启动失败: {e}");
                Ok(None)
            }
        }
    }

    /// 使用 macOS Vision 框架提取文字
    #[cfg(target_os = "macos")]
    fn extract_with_vision(&self, image_path: &Path) -> Result<Option<OcrResult>> {
        let script = r#"
use framework "Vision"
use framework "Foundation"
use framework "AppKit"
use scripting additions
on run argv
    set imagePath to item 1 of argv
    set theImage to current application's NSImage's alloc()'s initWithContentsOfFile:imagePath
    if theImage is missing value then
        return ""
    end if
    set requestHandler to current application's VNImageRequestHandler's alloc()'s initWithData:(theImage's TIFFRepresentation()) options:(current application's NSDictionary's dictionary())
    set theRequest to current application's VNRecognizeTextRequest's alloc()'s init()
    theRequest's setRecognitionLevel:(current application's VNRequestTextRecognitionLevelAccurate)
    theRequest's setRecognitionLanguages:{"zh-Hans", "en"}
    requestHandler's performRequests:{theRequest} |error|:(missing value)
    set theResults to theRequest's results()
    set outputText to ""
    repeat with observation in theResults
        set outputText to outputText & (observation's topCandidates:1)'s firstObject()'s |string|() & linefeed
    end repeat
    return outputText
end run
"#;

        let output = Self::run_command_with_timeout(
            Command::new("osascript")
                .arg("-l")
                .arg("AppleScript")
                .arg("-e")
                .arg(script)
                .arg(image_path),
            "Vision OCR",
        );

        match output {
            Ok(result) if result.status.success() => {
                let text = String::from_utf8_lossy(&result.stdout).trim().to_string();
                if text.is_empty() {
                    Ok(None)
                } else {
                    log::debug!("Vision OCR 识别到 {} 个字符", text.len());
                    Ok(Some(OcrResult {
                        text,
                        confidence: 0.9,
                        boxes: vec![],
                    }))
                }
            }
            Ok(result) => {
                log::warn!(
                    "Vision OCR 命令执行失败: {}",
                    String::from_utf8_lossy(&result.stderr)
                );
                Ok(None)
            }
            Err(e) => {
                log::warn!("Vision OCR 执行错误: {e}");
                Ok(None)
            }
        }
    }
}
