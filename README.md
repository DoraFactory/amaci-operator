# A-MACI Manager

## How to Start

### 初始化项目

```
npm install

npm run build
```

### 配置环境变量

参考 `.env.template` 中的模板，配置 `.env` 环境，其中主要注意：

- 需要通过 MNEMONIC 来配置一个可用的 Vota 网络钱包地址

  - 需要在 MNEMONIC 对应的地址中存入足够数量的 DORA Token 以便于能发送交易
  - 需要 Stake DORA 以获得对于 deactivate recorder 合约的写入权限

- 需要通过 COORDINATOR_PRI_KEY 来配置一个 MACI 管理员密钥

! 请注意妥善保管 MNEMONIC 和 COORDINATOR_PRI_KEY，尤其是 MNEMONIC 的丢失可能会造成实际的财产损失。

### 初始化环境

```
npm run init
```

可以看到 log 出来的 Coordinator public key，需要将这个信息收集并展示给我们。

脚本会下载执行 manage 所需要的 zkey 信息。

### 启动 MACI 服务

```
npm run manage

# 后台运行

nohup npm run manage > manage.log 2>&1 &
```

- Manage 服务会定期检查网络中是否有需要处理的 MACI Round

- 根据 Round 进行状态，可能会执行：

  - Deactivate 证明，处理用户的 deactivate message；
  - Tally 证明，在 Round 结束后进行计票和统计。

- Manage 服务会在 ./work 目录下记录处理的日志和其他一些缓存信息

### 故障排除

目前 MACI Manage 脚本还在测试阶段，可能会发生预期外的问题。如果发生故障，可以直接重启服务，并且通过 work 目录下的日志来定位问题原因。
