# 服务器数据生命周期

正式数据是唯一权威；同步历史只用于短期恢复；灾难恢复快照有独立对象池；升级回滚只保存本次更新所需程序和配置。普通代码升级不复制正式数据。数据库/格式迁移显式指定范围，禁止把已有备份目录再包进新备份。

## 配置语义

`backup.enabled=true`，`schedule=04:00`（服务进程本地时间），`compression=true`，`verify=true`；`retention.daily=7/weekly=4/monthly=3`，`maxStorageGiB=20` 可按项目调整。`backup.upgrade.keepLast=1/retentionDays=7`。Shale/Mojian 另有 `history.maxRevisions=100/retentionDays=30`（同时限制）与 `garbageCollection.enabled=true/intervalHours=24/gracePeriodHours=24`。Dayweave 不保存无限 manifest 历史；当前同步 base/必要幂等身份不是可清理历史。AI Decision 防重发业务账本继续由原维护规则保护。

日/周/月各取窗口内最新代表，始终保护最新已验证及手动 pinned 快照。容量上限可缩减较旧日历代表；最新/手动恢复点已超限时告警并保留它们。无变化不新建快照；淘汰前验证保留的恢复点。失败写日志和持久健康状态，不能以删除有效数据消除告警。

## 隔离和恢复

文件备份以压缩内容寻址对象去重，不与活跃 blob 硬链接。SQLite 必须使用 Online Backup API，然后完整性检查；不复制正在写入的 DB/WAL。恢复只写入新的不存在目录，校验成功后按产品恢复流程停服务、检查身份、配置路径和后来写入，再由运维决定正式接管。程序回滚保留后来正式写入，不能把旧业务库当代码回滚工具。

升级点必须有 `upgrade.json`，记录 format=1、createdAt 和 verifiedAt（毫秒）；只有通过程序启动、正式数据和核心 API 验证后设置 verifiedAt，才进入自动 1 份/7 天轮换。未验证/失败点只报告，不能悄悄删除。旧的未托管恢复目录须先逐项分类，不能按名字批量删除。

## 验收

测试覆盖正常恢复、去重/不变、日周月和容量轮换、损坏阻断删除、dry-run 无删除、升级范围及回滚到期。同步服务额外覆盖历史过期重取全清单、旧 CAS 拒绝、分页与活跃上传保护。源码/隔离测试通过不等于生产部署或自然定时任务验收，现场结果另记当月日志。
