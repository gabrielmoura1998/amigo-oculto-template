#!/usr/bin/env bash
# Configura o Amigo Oculto 2026 a partir do Google Cloud Shell.
# Faz: Firestore, regras, config inicial, app web, chave do sorteio, repo no GitHub, secret e Pages.
set -euo pipefail
cd "$(dirname "$0")"
ok(){ printf '\n\033[1;32m✔ %s\033[0m\n' "$1"; }
step(){ printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }

echo "Teus projetos:"; gcloud projects list --format='table(projectId,name)'
read -rp "ID do projeto Firebase (coluna PROJECT_ID): " P
read -rp "E-mails dos admins, separados por espaço (o teu primeiro): " ADMINS
DEF_REPO=$(basename -s .git "$(git config --get remote.origin.url 2>/dev/null || echo amigo-oculto)")
read -rp "Nome do repo no GitHub [$DEF_REPO]: " REPO; REPO=${REPO:-$DEF_REPO}

step "Projeto e APIs"
gcloud config set project "$P" >/dev/null
gcloud services enable firestore.googleapis.com firebaserules.googleapis.com identitytoolkit.googleapis.com firebase.googleapis.com
ok "APIs ligadas"

step "Banco Firestore (São Paulo)"
if gcloud firestore databases describe --database='(default)' >/dev/null 2>&1; then echo "Já existe, seguindo."
else gcloud firestore databases create --location=southamerica-east1 --type=firestore-native; fi
ok "Firestore pronto"

step "Configuração inicial (config/app)"
BODY=$(python3 - "$ADMINS" <<'PY'
import json,sys
em=[e.strip().lower() for e in sys.argv[1].split() if e.strip()]
arr={"arrayValue":{"values":[{"stringValue":e} for e in em]}}
print(json.dumps({"fields":{"allowed":arr,"admins":arr,"finalLocked":{"booleanValue":False},
  "orderOpen":{"booleanValue":False},"testNo":{"integerValue":"0"}}}))
PY
)
CODE=$(curl -s -o /tmp/cfg.out -w '%{http_code}' -X PATCH \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "Content-Type: application/json" \
  "https://firestore.googleapis.com/v1/projects/$P/databases/(default)/documents/config/app?currentDocument.exists=false" -d "$BODY")
if [ "$CODE" = 200 ]; then ok "config/app criado"; elif grep -q -i "exist" /tmp/cfg.out; then echo "config/app já existia, mantive."; else cat /tmp/cfg.out; exit 1; fi

step "Login no Firebase CLI"
command -v firebase >/dev/null || npm install -g firebase-tools
firebase projects:list >/dev/null 2>&1 || firebase login --no-localhost

step "Regras de segurança"
echo '{"firestore":{"rules":"firestore.rules"}}' > firebase.json
firebase deploy --only firestore:rules --project "$P" --non-interactive
ok "Regras publicadas"

step "App web e firebaseConfig"
APP_ID=$(firebase apps:list WEB --project "$P" --json | python3 -c 'import json,sys;r=json.load(sys.stdin)["result"];print(r[0]["appId"] if r else "")')
if [ -z "$APP_ID" ]; then
  APP_ID=$(firebase apps:create WEB amigo-oculto --project "$P" --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["result"]["appId"])')
fi
firebase apps:sdkconfig WEB "$APP_ID" --project "$P" --json > /tmp/sdk.json
python3 - <<'PY'
import json,re,sys
d=json.load(open('/tmp/sdk.json'))["result"]
c=d.get("sdkConfig") or json.loads(re.search(r'\{.*\}',d["fileContents"],re.S).group(0))
keep={k:c[k] for k in ("apiKey","authDomain","projectId","appId") if k in c}
s=open('index.html').read()
s=re.sub(r'const firebaseConfig = \{.*?\};','const firebaseConfig = '+json.dumps(keep,indent=2)+';',s,count=1,flags=re.S)
open('index.html','w').write(s)
PY
ok "index.html configurado"

step "Chave de servidor pro sorteio"
SA=$(gcloud iam service-accounts list --format='value(email)' --filter='email~firebase-adminsdk' | head -1)
[ -n "$SA" ] || { echo "Não achei a conta firebase-adminsdk. Abre o projeto no console do Firebase uma vez e roda de novo."; exit 1; }
KEY="$HOME/.sa-amigo-oculto.json"
gcloud iam service-accounts keys create "$KEY" --iam-account="$SA" >/dev/null
ok "Chave criada (fora do repo)"

step "GitHub"
if ! command -v gh >/dev/null; then
  curl -sSL https://github.com/cli/cli/releases/download/v2.62.0/gh_2.62.0_linux_amd64.tar.gz | tar xz -C "$HOME"
  export PATH="$HOME/gh_2.62.0_linux_amd64/bin:$PATH"
fi
gh auth status >/dev/null 2>&1 || gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
GH_USER=$(gh api user -q .login)
git config user.email >/dev/null || git config --global user.email "$GH_USER@users.noreply.github.com"
git config user.name  >/dev/null || git config --global user.name "$GH_USER"
rm -f firebase.json
[ -d .git ] || git init -q -b main
printf '*.json.key\n.sa-*\nfirebase.json\n.firebaserc\n' > .gitignore
git add -A
git commit -qm "Configura Firebase" || true
if gh repo view "$GH_USER/$REPO" >/dev/null 2>&1; then
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$GH_USER/$REPO.git"
  git pull --rebase -q origin main 2>/dev/null || true
  git push -u origin HEAD:main
else
  gh repo create "$GH_USER/$REPO" --public --source=. --push
fi
gh secret set FIREBASE_SA --repo "$GH_USER/$REPO" < "$KEY"
shred -u "$KEY" 2>/dev/null || rm -f "$KEY"
ok "Código no GitHub e secret FIREBASE_SA salvo (chave apagada do Cloud Shell)"

step "GitHub Pages"
gh api -X POST "repos/$GH_USER/$REPO/pages" -f 'source[branch]=main' -f 'source[path]=/' >/dev/null 2>&1 || echo "(Pages já estava ligado)"
ok "Pronto!"
cat <<EOF

Site:     https://$GH_USER.github.io/$REPO/   (leva 1–2 min na primeira vez)
Sorteio:  https://github.com/$GH_USER/$REPO/actions/workflows/sorteio.yml

Falta só no console do Firebase (Authentication):
  1. Começar → Método de login → ativar Google e E-mail/senha
  2. Configurações → Domínios autorizados → adicionar  $GH_USER.github.io
EOF
