#!/bin/bash
# 打包成可上传 Coze 部署的压缩包：剔除依赖、构建产物与密钥，保留可直接 `pnpm install` 起步的源码。
set -Eeuo pipefail

# 定位项目根目录（脚本所在目录的上一级），保证在任意位置调用都正确
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

if ! command -v zip >/dev/null 2>&1; then
  echo "❌ 未找到 zip 命令，请先安装 zip" >&2
  exit 1
fi

NAME="$(node -p "require('./package.json').name || 'app'" 2>/dev/null || echo app)"
VERSION="$(node -p "require('./package.json').version || '0.0.0'" 2>/dev/null || echo 0.0.0)"
DATE="$(date +%Y%m%d)"

OUT_DIR="${ROOT_DIR}/release"
ARCHIVE="${OUT_DIR}/${NAME}-${VERSION}-${DATE}.zip"

mkdir -p "${OUT_DIR}"
rm -f "${ARCHIVE}"

echo "打包 ${NAME}@${VERSION} ..."

# 排除项：依赖 / 构建产物 / 版本库 / 所有环境文件 / 输出目录自身 / 本地杂项。
# .env 一律不入包：里面有 Supabase service role key、教师密码与会话签名密钥，
# 线上值必须在 Coze 环境变量里单独配。
zip -r -q "${ARCHIVE}" . \
  -x "node_modules/*" "*/node_modules/*" \
  -x ".next/*" \
  -x "dist/*" \
  -x ".git/*" \
  -x "release/*" \
  -x ".env*" "*/.env*" \
  -x "*.log" \
  -x "*.tsbuildinfo" \
  -x "*.DS_Store" \
  -x ".turbo/*" \
  -x "coverage/*" \
  -x "assets/*"
# assets/ 是设计稿与截图原图（约 30M），Next.js 只对外提供 public/，
# 代码里没有任何引用，入包纯粹拖慢上传，故排除。需要留档就手动带上。

# 仅重新加入不含真实密钥的示例配置。
if [[ -f ".env.example" ]]; then
  zip -q "${ARCHIVE}" ".env.example"
fi

SIZE="$(du -h "${ARCHIVE}" | cut -f1)"
echo "✅ 已生成：${ARCHIVE} (${SIZE})"
echo
echo "Coze 部署步骤："
echo "  1. 上传压缩包并实例化 Supabase（COZE_* 变量由平台注入）"
echo "  2. 在 Supabase 执行 scripts/migrations/001-case-type.sql（如需仲裁场景）"
echo "  3. 在 Coze 配置 TEACHER_PASSWORD（必填，无默认值）与 AUTH_SECRET（建议）"
echo "  4. 部署后访问首页，注册一个学生账号并登录验证；再用教师密码验证教师端"
