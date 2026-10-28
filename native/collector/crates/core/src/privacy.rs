use crate::config::{PrivacyConfig, PrivacyLevel};
use regex::Regex;

/// 隐私检查结果
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PrivacyAction {
    /// 正常记录（截图 + 统计）
    Record,
    /// 内容脱敏（只统计时长，不保存截图）
    Anonymize,
    /// 完全跳过（不记录任何信息）
    Skip,
}

/// 隐私过滤器
pub struct PrivacyFilter {
    config: PrivacyConfig,
    sensitive_patterns: Vec<Regex>,
}

impl PrivacyFilter {
    /// 从配置创建隐私过滤器
    pub fn from_config(config: &PrivacyConfig) -> Self {
        let sensitive_patterns = vec![
            // 信用卡号
            Regex::new(r"\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b").unwrap(),
            // 手机号
            Regex::new(r"\b1[3-9]\d{9}\b").unwrap(),
            // 身份证号
            Regex::new(r"\b\d{17}[\dXx]\b").unwrap(),
            // 邮箱
            Regex::new(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b").unwrap(),
            // 密码字段
            Regex::new(r"(?i)(password|密码|pwd|passwd)[\s:：=]+\S+").unwrap(),
            // API Key
            Regex::new(r"(?i)(api[_-]?key|secret|token)[\s:：=]+\S+").unwrap(),
        ];

        Self {
            config: config.clone(),
            sensitive_patterns,
        }
    }

    /// 检查应用和窗口的隐私操作
    /// 返回应该采取的隐私行动
    pub fn check_privacy(&self, app_name: &str, window_title: &str) -> PrivacyAction {
        // 1. 先检查应用级别的隐私规则
        let app_level = self.config.get_app_privacy_level(app_name);

        match app_level {
            PrivacyLevel::Ignored => {
                log::debug!("应用 {app_name} 设置为完全忽略");
                return PrivacyAction::Skip;
            }
            PrivacyLevel::Anonymized => {
                log::debug!("应用 {app_name} 设置为内容脱敏");
                return PrivacyAction::Anonymize;
            }
            PrivacyLevel::Full => {
                // 继续检查窗口标题
            }
        }

        // 2. 检查窗口标题关键词（匹配时使用脱敏模式）
        if self.config.should_anonymize_by_keyword(window_title) {
            log::debug!("窗口标题匹配敏感关键词，使用脱敏模式");
            return PrivacyAction::Anonymize;
        }

        PrivacyAction::Record
    }

    /// 检查 URL 域名是否在黑名单中
    /// 如果匹配，返回 Skip；否则返回 Record
    pub fn check_url_privacy(&self, url: Option<&str>) -> PrivacyAction {
        if let Some(url) = url {
            if !url.is_empty() {
                let domain = PrivacyConfig::extract_domain(url);

                for excluded in &self.config.excluded_domains {
                    let excluded_domain = PrivacyConfig::extract_domain(excluded);

                    if !domain.is_empty() && !excluded_domain.is_empty() {
                        if PrivacyConfig::domain_matches(&domain, &excluded_domain) {
                            log::debug!("URL 域名 {domain} 匹配黑名单 {excluded_domain}, 跳过记录");
                            return PrivacyAction::Skip;
                        }
                    }
                }
            }
        }
        PrivacyAction::Record
    }

    /// 综合检查：应用 + 窗口标题 + URL
    pub fn check_privacy_full(
        &self,
        app_name: &str,
        window_title: &str,
        browser_url: Option<&str>,
    ) -> PrivacyAction {
        // 1. 先检查应用和窗口标题
        let app_action = self.check_privacy(app_name, window_title);
        if app_action == PrivacyAction::Skip {
            return PrivacyAction::Skip;
        }

        // 2. 检查 URL 域名黑名单
        let url_action = self.check_url_privacy(browser_url);
        if url_action == PrivacyAction::Skip {
            return PrivacyAction::Skip;
        }

        // 3. 返回应用级别的结果（可能是 Record 或 Anonymize）
        if browser_url.is_some_and(|url| self.config.should_anonymize_by_keyword(url)) {
            PrivacyAction::Anonymize
        } else {
            app_action
        }
    }

    /// 兼容旧接口：检查是否应该跳过
    pub fn should_skip(&self, app_name: &str, window_title: &str) -> bool {
        self.check_privacy(app_name, window_title) == PrivacyAction::Skip
    }

    /// 过滤OCR文本中的敏感信息
    pub fn filter_text(&self, text: &str) -> String {
        let mut filtered = text.to_string();

        for pattern in &self.sensitive_patterns {
            filtered = pattern.replace_all(&filtered, "[已过滤]").to_string();
        }

        filtered
    }

    /// 更新配置
    pub fn update_config(&mut self, config: &PrivacyConfig) {
        self.config = config.clone();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AppPrivacyRule;

    #[test]
    fn test_privacy_levels() {
        let mut config = PrivacyConfig::default();
        config.app_rules.push(AppPrivacyRule {
            app_name: "WeChat".to_string(),
            level: PrivacyLevel::Anonymized,
        });

        let filter = PrivacyFilter::from_config(&config);

        // 完全忽略
        assert_eq!(
            filter.check_privacy("1Password", "Main"),
            PrivacyAction::Skip
        );

        // 内容脱敏（通过规则）
        assert_eq!(
            filter.check_privacy("WeChat", "Chat"),
            PrivacyAction::Anonymize
        );

        // 正常记录
        assert_eq!(
            filter.check_privacy("VS Code", "main.rs"),
            PrivacyAction::Record
        );
    }

    #[test]
    fn test_keyword_anonymize() {
        let config = PrivacyConfig::default();
        let filter = PrivacyFilter::from_config(&config);

        // 关键词触发脱敏
        assert_eq!(
            filter.check_privacy("Chrome", "Bank Login"),
            PrivacyAction::Anonymize
        );
        assert_eq!(
            filter.check_privacy("Firefox", "Enter password"),
            PrivacyAction::Anonymize
        );

        // 正常记录
        assert_eq!(
            filter.check_privacy("Chrome", "GitHub"),
            PrivacyAction::Record
        );
    }

    #[test]
    fn test_filter_text() {
        let config = PrivacyConfig::default();
        let filter = PrivacyFilter::from_config(&config);

        let text = "My phone is 13812345678 and card is 1234-5678-9012-3456";
        let filtered = filter.filter_text(text);

        assert!(filtered.contains("[已过滤]"));
        assert!(!filtered.contains("13812345678"));
    }

    #[test]
    fn sensitive_url_anonymizes_even_without_a_title() {
        let filter = PrivacyFilter::from_config(&PrivacyConfig::default());
        assert_eq!(
            filter.check_privacy_full("Chrome", "", Some("https://example.com/login")),
            PrivacyAction::Anonymize
        );
    }
}
