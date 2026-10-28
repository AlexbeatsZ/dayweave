#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Unknown(String),
    #[error("{0}")]
    Screenshot(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Image(#[from] image::ImageError),
    #[error("{0}")]
    Serialization(#[from] serde_json::Error),
}
pub type Result<T> = std::result::Result<T, AppError>;
