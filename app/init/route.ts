import fs from 'node:fs';
import path from 'node:path';

const APP_URL = process.env.AUTH_TRUST_HOST || 'http://localhost:8001';
// Segredo compartilhado que autoriza o /init a chamar /api/mailu-account --
// mesmo nivel de confianca que authorized_keys ja tem hoje (quem consegue
// buscar /init ja recebe suas chaves SSH).
const PROVISION_TOKEN = process.env.PROVISION_TOKEN || '';
// Mesmo diretorio que o zxnet/init.sh chamavam de $SYNC_HOME — mirror do
// home do usuario, sincronizado pelo Syncthing entre todos os hosts. Serve
// o conteudo real direto daqui, sem duplicar em outro lugar.
const SYNC_HOME_DIR = process.env.SYNC_HOME_DIR || '/var/rcaldas/live/home';
const SYNC_BIN_DIR = process.env.SYNC_BIN_DIR || '/var/rcaldas/live/bin';
const SAFE_FILENAME = /^[\w.-]+$/;
// live/bin e pra scripts, nao pra artefatos de teste/benchmark que alguem
// deixe la por engano (ja aconteceu: um arquivo de teste de disco de 129MB
// derrubou o processo inteiro com OOM ao tentar embutir tudo num template).
const MAX_BIN_FILE_BYTES = 1024 * 1024;

function readSecret(relativePath: string, placeholder: string) {
  try {
    return fs.readFileSync(path.join(SYNC_HOME_DIR, relativePath), 'utf8').replace(/\r\n/g, '\n');
  } catch {
    return placeholder;
  }
}

// Escreve cada script de $SYNC_BIN direto em $BIN_DIR no host novo, com o
// conteudo real de agora (mesma ideia de readSecret, mas pra varios arquivos).
function buildBinInstallScript() {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(SYNC_BIN_DIR, { withFileTypes: true });
  } catch {
    // ":" (no-op) e necessario -- isso pode ser inserido dentro de um bloco
    // if/else no script gerado, e um comentario sozinho deixa o bloco vazio,
    // o que e erro de sintaxe em bash.
    return `: # live/bin ainda nao sincronizado em ${SYNC_BIN_DIR}`;
  }
  const files = entries.filter((e) => e.isFile() && SAFE_FILENAME.test(e.name));
  if (!files.length) return ': # nenhum script em live/bin no momento do provisionamento';

  const parts = files.map((entry, index) => {
    // Alguns arquivos em live/bin sao propositalmente sem leitura para
    // "outros" (o processo do container nao e nem o dono nem o grupo) --
    // provavelmente por conterem algo sensivel. Pula em vez de derrubar a
    // rota inteira com EACCES.
    try {
      const filePath = path.join(SYNC_BIN_DIR, entry.name);
      if (fs.statSync(filePath).size > MAX_BIN_FILE_BYTES) {
        return `: # ${entry.name} maior que ${MAX_BIN_FILE_BYTES} bytes, pulado (nao parece ser um script)`;
      }
      const content = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
      const delim = `BINFILE_${index}_EOF`;
      return `cat <<'${delim}' > "$BIN_DIR"/${entry.name}\n${content}\n${delim}\nchmod +x "$BIN_DIR"/${entry.name}`;
    } catch {
      return `: # ${entry.name} nao legivel pelo container, pulado`;
    }
  });

  return parts.join('\n');
}

function script() {
  const bashrc = readSecret('.bashrc', `# .bashrc ainda nao sincronizado em ${SYNC_HOME_DIR}`);
  const bashAliases = readSecret('.bash_aliases', '# .bash_aliases ainda nao sincronizado');
  const authorizedKeys = readSecret(
    '.ssh/authorized_keys',
    `# nenhuma chave sincronizada em ${SYNC_HOME_DIR}/.ssh/authorized_keys`
  );
  const sshConfig = readSecret('.ssh/config', '# .ssh/config ainda nao sincronizado');
  const binInstallScript = buildBinInstallScript();

  return `#!/usr/bin/env bash

### PROCEDIMENTOS MANUAIS
# - root password
# - sources.list
# - firmwares
# - network/interfaces

USER="rcaldas"
NAME_USER="Robson Caldas"
HOME_USER="/var/$USER"
MAIL_USER="rclgsm@gmail.com"
DOMAIN="rcaldas.com"

SSH_PORT="8422"

BIN_DIR="/usr/local/bin"
SYNC_BIN="$HOME_USER/live/bin"
SYNC_HOME="$HOME_USER/live/home"

MAIL_ADMIN="rclgsm@gmail.com"
SMTP_SERVER='us.rcaldas.com'
SMTP_PORT=587

WALLPAPER="https://rcaldas.com/wallpapers/00.jpg"

FASTFETCH_URL="https://github.com/fastfetch-cli/fastfetch/releases/latest/download/fastfetch-linux-amd64.deb"
FIREFOX_URL="https://download.mozilla.org/?product=firefox-latest-ssl&os=linux64&lang=pt-BR"

default_apps="sudo rsync curl tmux python3-pip openssh-server dnsutils wget \\
  iperf3 sed git bash-completion pv net-tools nftables chrony fio \\
  nmap iputils-ping ipvsadm unattended-upgrades jq htop iotop sysstat \\
  ca-certificates apt-transport-https lsb-release debian-goodies"

  # gnupg2
  # shim-signed
  # qemu-guest-agent
  # amd64-microcode
  # intel-microcode

  # firmware-linux-nonfree firmware-ipw2x00 firmware-bnx2x firmware-intel-sound \\
  # firmware-brcm80211 firmware-intelwimax firmware-libertas firmware-atheros \\
  # firmware-amd-graphics firmware-ralink firmware-realtek firmware-iwlwifi \\

  # lightdm lightdm-gtk-greeter mate-desktop-environment-extras

desktop_apps="iotop iftop hdparm zip unzip unrar-free p7zip findutils \\
              build-essential gparted ntfs-3g xdg-utils redshift-gtk \\
              autotools-dev autoconf g++ \\
              gnupg2 gnupg-agent cups system-config-printer printer-driver-all \\
              openprinting-ppds hp-ppd vlc x11vnc \\
              pavucontrol network-manager gnome-terminal \\
              cputool tlp ruby-notify sg3-utils"

RESOLV_CONF=$(cat <<EOF
search rcaldas.com
nameserver 8.8.4.4
nameserver 1.0.0.1
nameserver 2620:0:ccc::2
EOF
)

### Check Root
[ $(id -u) = 0 ] || {
  echo -e "\\nNot root.\\nExiting."
  exit 1
}

### Helper App Installer
function package_installer(){
  [[ -z $1 ]] && {
    echo "Need packages as argument"; return
  }
  for_install=''
  for p in $1; do
    if ! dpkg -s "$p" &> /dev/null; then
      for_install=$for_install' '$p
    fi
  done
  [ -z "$for_install" ] || {
    apt-get update > /dev/null
    DEBIAN_FRONTEND=noninteractive apt-get -qq --allow-change-held-packages install $for_install > /dev/null
    apt-get -qq clean
  }
  if ! dpkg -s fastfetch &> /dev/null; then
    curl -Ls $FASTFETCH_URL -o /tmp/fastfetch-linux-amd64.deb
    dpkg -i /tmp/fastfetch-linux-amd64.deb > /dev/null
    apt install -yf > /dev/null
    rm /tmp/fastfetch-linux-amd64.deb
  fi
}

### Ask options
function ask_user(){
  read < /dev/tty -rep $'\\n[USER] Change user?\\n['$USER$']> ' NEWUSER
  if [[ -n $NEWUSER ]]; then
    USER=$NEWUSER
  fi

  read < /dev/tty -rep $'\\n[USER] Change username?\\n['"$NAME_USER"$']> ' NEWNAME_USER
  if [[ -n $NEWNAME_USER ]]; then
    NAME_USER=$NEWNAME_USER
  fi

  read < /dev/tty -rep $'\\n[USER] Change user home?\\n['$HOME_USER$']> ' NEWHOME_USER
  if [[ -n $NEWHOME_USER ]]; then
    HOME_USER=$NEWHOME_USER
  fi
}

function asks(){
  read < /dev/tty -rep $'\\n[HOSTNAME] Change hostname?\\n['$HOSTNAME$']> ' NEWHOSTNAME

  read < /dev/tty -rep $'\\n[DNS] DNS Static or Dynamic\\n(s/d)> ' SETDNS

  read < /dev/tty -rep $'\\n[SSH] Change SSH Config (port and match user)?\\n(Y/n)> ' CHANGESSH

  read < /dev/tty -rep $'\\n[SMTP] Set SMTP Password?\\n(Y/n)> ' SET_SMTP_PWD

  read < /dev/tty -rep $'\\n[SYNCTHING] Install syncthing?\\n(y/N)> ' INSTSYNC

  read < /dev/tty -rep $'\\n[DOCKER] Install Docker for Debian x64?\\n(y/N)> ' INSTDOCKER

  read < /dev/tty -rep $'\\n[DESKTOP] It\\'s a Desktop?\\n(y/N)> ' ISDESKTOP
}

function set_hostname(){
    echo hostname
    echo "$NEWHOSTNAME" > /etc/hostname
    hostname -F /etc/hostname
    HOSTNAME=$NEWHOSTNAME
    sed -i "/^127.0.0.1/c\\127.0.0.1\\tlocalhost" /etc/hosts
    grep -q "127.0.1.1" /etc/hosts && \\
      sed -i "/^127.0.1.1/c\\127.0.1.1\\t$HOSTNAME.$DOMAIN\\t$HOSTNAME" /etc/hosts || \\
      sed -i "0,/localhost/s//localhost\\n127.0.1.1\\t$HOSTNAME.$DOMAIN\\t$HOSTNAME/" /etc/hosts
}

function set_dns(){
  if [ "$SETDNS" == "S" ] || [ "$SETDNS" == "s" ]; then
    echo static_dns
    DEBIAN_FRONTEND=noninteractive apt-get -qq purge resolvconf rdnssd &> /dev/null
    systemctl disable --now systemd-resolved &> /dev/null
    systemctl disable --now resolvconf &> /dev/null
    if [ -d /etc/dhcp/dhclient-enter-hooks.d ]; then
      echo -e '#!/bin/sh\\nmake_resolv_conf(){ : ; }' > /etc/dhcp/dhclient-enter-hooks.d/nodnsupdate
      chmod +x /etc/dhcp/dhclient-enter-hooks.d/nodnsupdate
    fi
    [ -d /etc/NetworkManager/conf.d ] && echo -e "[main]\\ndns=none" > /etc/NetworkManager/conf.d/no-dns.conf
    rm -rf /etc/resolv.conf
    echo -e "$RESOLV_CONF" > /etc/resolv.conf
  elif [ "$SETDNS" == "D" ] || [ "$SETDNS" == "d" ]; then
    echo dynamic_dns
    systemctl enable systemd-resolved &> /dev/null
    rm -f /etc/dhcp/dhclient-enter-hooks.d/nodnsupdate /etc/NetworkManager/conf.d/no-dns.conf &> /dev/null
  fi
}

function set_timezone(){
  echo timezone
  echo "America/Sao_Paulo" > /etc/timezone
  ln -sf /usr/share/zoneinfo/America/Sao_Paulo /etc/localtime
  echo -e "en_US.UTF-8 UTF-8\\npt_BR.UTF-8 UTF-8" > /etc/locale.gen
  locale -a | grep -q "pt_BR.utf8" || /usr/sbin/locale-gen > /dev/null
  locale -a | grep -q "en_US.utf8" || /usr/sbin/locale-gen > /dev/null
}

function set_packages(){
  echo packages
  package_installer "$default_apps"

  cat <<'EOF' > /etc/apt/apt.conf.d/02periodic
APT::Periodic::Enable "1";
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "5";
APT::Periodic::Verbose "0";
EOF
  cat <<EOF > /etc/apt/apt.conf.d/50unattended-upgrades
Unattended-Upgrade::Origins-Pattern {
  "origin=Debian";
};
//    "always", "only-on-error" or "on-change"
Unattended-Upgrade::MailReport "only-on-error";
Unattended-Upgrade::Mail "$MAIL_ADMIN";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
}

function set_ssh(){
  echo ssh
  grep -q "Port " /etc/ssh/sshd_config && {
    sed -i "s/#*Port\\s.*$/Port $SSH_PORT/" /etc/ssh/sshd_config
    } || sed -i "1iPort $SSH_PORT" /etc/ssh/sshd_config

  grep -q "Match User $USER" /etc/ssh/sshd_config || \\
    echo -e "Match User $USER\\n\\tX11Forwarding yes\\n\\tAllowTcpForwarding yes\\n\\tGatewayPorts yes" \\
      >> /etc/ssh/sshd_config

  > /etc/motd
  > /etc/issue
  > /etc/issue.net
  systemctl enable ssh &> /dev/null || update-rc.d ssh enable &> /dev/null
  systemctl restart ssh &> /dev/null || /etc/init.d/ssh restart &> /dev/null
}

function ensure_root_key(){
  echo ssh-root-key
  if [[ ! -f /root/.ssh/id_ed25519.pub ]] && ! ls /root/.ssh/id_*.pub &> /dev/null; then
    yes '' | ssh-keygen -qt ed25519 -N '' > /dev/null
  fi
  PUBKEY=$(cat /root/.ssh/id_ed25519.pub 2>/dev/null || cat /root/.ssh/id_*.pub 2>/dev/null | head -1)
  echo -e "\\nChave publica do root (adicione no relay se for usar tunel reverso): $PUBKEY\\n"
}

function set_smtp(){
  echo smtp
  package_installer "libsasl2-modules postfix mailutils"
  echo "$DOMAIN" > /etc/mailname

  [ ! -e /etc/postfix/main.cf.bkp ] && \\
    cp /etc/postfix/main.cf /etc/postfix/main.cf.bkp
  cat <<EOF > /etc/postfix/main.cf
myhostname = $DOMAIN
inet_interfaces = loopback-only
relayhost = [$SMTP_SERVER]:$SMTP_PORT
smtp_sasl_auth_enable = yes
smtp_sasl_security_options = noanonymous
smtp_sasl_password_maps = hash:/etc/postfix/sasl_passwd
smtp_generic_maps = hash:/etc/postfix/generic
smtp_use_tls = yes
mynetworks_style = host
smtp_tls_CAfile = /etc/ssl/certs/ca-certificates.crt
smtp_tls_CApath = /etc/ssl/certs
inet_protocols = ipv4
compatibility_level = 2
EOF

  [ -f /root/.forward ] && {
    [ ! -e /root/.forward.bkp ] && cp /root/.forward /root/.forward.bkp
  }
  echo "$MAIL_ADMIN" > /root/.forward

  grep -q '^root:' /etc/aliases && \\
    sudo sed -i "/^root:/c\\root: $MAIL_ADMIN" /etc/aliases || \\
      echo "root: $MAIL_ADMIN" >> /etc/aliases
  newaliases

  echo -e "@$DOMAIN\\t$HOSTNAME@$DOMAIN" > /etc/postfix/generic
  postmap /etc/postfix/generic

  if [ "$SET_SMTP_PWD" == "n" ] || [ "$SET_SMTP_PWD" == "N" ]; then
    :
  else
    SMTP_PWD=$(< /dev/urandom tr -dc _A-Z-a-z-0-9 | head -c16)
    echo "[$SMTP_SERVER]:$SMTP_PORT $HOSTNAME@$DOMAIN:$SMTP_PWD" >\\
                                                      /etc/postfix/sasl_passwd
    chmod 600 /etc/postfix/sasl_passwd
    postmap /etc/postfix/sasl_passwd

    if curl -fsS -m 15 -H 'Content-Type: application/json' -X POST "${APP_URL}/api/mailu-account" \\
        -d "{\\"host\\":\\"$HOSTNAME\\",\\"domain\\":\\"$DOMAIN\\",\\"password\\":\\"$SMTP_PWD\\",\\"provisionToken\\":\\"${PROVISION_TOKEN}\\"}" > /dev/null 2>&1; then
      echo "Conta SMTP criada/atualizada no Mailu: $HOSTNAME@$DOMAIN"
    else
      echo "Nao foi possivel criar a conta no Mailu automaticamente -- cadastre manualmente: $HOSTNAME@$DOMAIN / $SMTP_PWD"
    fi

    unset SMTP_PWD
  fi

  postfix set-permissions
  systemctl restart postfix &> /dev/null || /etc/init.d/postfix restart &> /dev/null

  grep -q 'MAILTO=' /etc/crontab && \\
    sed -i "/MAILTO=/c\\MAILTO=$MAIL_ADMIN" /etc/crontab || \\
    sed -i "1iMAILTO=$MAIL_ADMIN" /etc/crontab

  grep -q 'MAILFROM=' /etc/crontab && \\
    sed -i "/MAILFROM=/c\\MAILFROM=$HOSTNAME@$DOMAIN" /etc/crontab || \\
    sed -i "1iMAILFROM=$HOSTNAME@$DOMAIN" /etc/crontab
}

function set_user(){
  echo user
  if grep -q "^$USER:" /etc/passwd; then
    usermod -md "$HOME_USER" "$USER" &> /dev/null
    usermod -aG sudo,dialout -g adm -c \\""$NAME_USER"\\" -s /bin/bash -u 8484 "$USER" &> /dev/null
  else
    useradd -N -G sudo,dialout -g adm -md "$HOME_USER" -c \\""$NAME_USER"\\" -s /bin/bash -u 8484 "$USER" &> /dev/null
  fi

  [[ -d $HOME_USER/.ssh ]] || su - $USER -c "mkdir $HOME_USER/.ssh"

  [[ -f $HOME_USER/.ssh/id_ed25519.pub ]] || {
    su - $USER -c "yes '' | ssh-keygen -qt ed25519 -N '' > /dev/null"
  }

  # Bin: se o Syncthing local ja tiver sincronizado $SYNC_BIN neste host,
  # usa link simbolico (fica ao vivo, acompanha futuras mudancas). Senao,
  # usa o conteudo atual servido pelo /init direto do servidor central.
  # Checar isso de novo a cada execucao evita perder os links se o /init
  # for rodado de novo depois que o Syncthing ja estiver configurado aqui.
  if [[ -d $SYNC_BIN ]]; then
    for i in $(find "$SYNC_BIN" -type f); do
      rm "$BIN_DIR""${'$'}{i#$SYNC_BIN}" &> /dev/null
      ln -sf "$i" "$BIN_DIR""${'$'}{i#$SYNC_BIN}"
      chmod +x "$i"
    done
  else
    ${binInstallScript}
  fi

  # Home: mesma logica -- symlink se o Syncthing local ja sincronizou,
  # senao conteudo atual servido pelo /init.
  if [[ -d $SYNC_HOME ]]; then
    for i in $(find "$SYNC_HOME" -type f); do
      rm "$HOME_USER""${'$'}{i#$SYNC_HOME}" &> /dev/null
      ln -s "$i" "$HOME_USER""${'$'}{i#$SYNC_HOME}"
      chown -h $USER: "$HOME_USER""${'$'}{i#$SYNC_HOME}"
    done
  else
    rm $HOME_USER/.bashrc &> /dev/null
    cat <<'EOF' > $HOME_USER/.bashrc
${bashrc}
EOF
    rm $HOME_USER/.bash_aliases &> /dev/null
    cat <<'EOF' > $HOME_USER/.bash_aliases
${bashAliases}
EOF
    rm $HOME_USER/.ssh/authorized_keys &> /dev/null
    cat <<'EOF' > $HOME_USER/.ssh/authorized_keys
${authorizedKeys}
EOF
    rm $HOME_USER/.ssh/config &> /dev/null
    cat <<'EOF' > $HOME_USER/.ssh/config
${sshConfig}
EOF
  fi

  for file in $(ls -Ad $HOME_USER/.??*); do
    chown -Rh $USER: $file
  done

  rm /root/.bashrc &> /dev/null
  cp $HOME_USER/.bashrc /root/.bashrc
  cp $HOME_USER/.ssh/config /root/.ssh/

  [[ -f $HOME_USER/.gitconfig ]] || \\
      su - $USER -c "cat <<EOF > $HOME_USER/.gitconfig
[user]
email = $HOSTNAME@$DOMAIN
name = $NAME_USER
[cola]
spellcheck = false
[pull]
rebase = false
EOF"

  sed -i "/#*$USER\\t/d" /etc/sudoers
  echo -e "$USER\\tALL=(ALL)\\tNOPASSWD:ALL" >> /etc/sudoers
}

function set_tune2fs(){
  echo tune2fs
  for i in / /var /var/log /home; do
    PART=$(df $i | grep $i$ | awk '{ print $1 }')
    [[ -n $PART ]] && {
      sudo tune2fs -c 2 $PART &> /dev/null
    }
  done
}

function set_syncthing(){
  echo Syncthing
  sudo mkdir -p /etc/apt/keyrings
  sudo curl -L -o /etc/apt/keyrings/syncthing-archive-keyring.gpg https://syncthing.net/release-key.gpg
  echo "deb [signed-by=/etc/apt/keyrings/syncthing-archive-keyring.gpg] https://apt.syncthing.net/ syncthing stable" | sudo tee /etc/apt/sources.list.d/syncthing.list
  printf "Package: *\\nPin: origin apt.syncthing.net\\nPin-Priority: 990\\n" | sudo tee /etc/apt/preferences.d/syncthing.pref

  echo "fs.inotify.max_user_watches=204800" | sudo tee /etc/sysctl.d/syncthing.conf > /dev/null
  sysctl --system > /dev/null
  package_installer "syncthing"
}

function set_docker(){
  echo Docker
  apt-get -qq remove docker docker-engine docker.io containerd runc &> /dev/null
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --yes --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
  package_installer "docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"

  cat > /etc/sysctl.d/docker.conf <<'EOF'
vm.max_map_count=262144

fs.inotify.max_user_watches = 524288
fs.inotify.max_user_instances = 512
EOF
  sysctl --system > /dev/null

  systemctl enable docker &> /dev/null
  usermod -aG docker "$USER" > /dev/null
}

### Desktop tasks
function set_swappiness(){
  echo swappiness
  echo "vm.swappiness=10" > /etc/sysctl.d/swappiness.conf
  sysctl --system > /dev/null
}

function set_lightdm(){
  echo lightdm
  if dpkg -s lightdm &> /dev/null; then
    if [ -f /usr/share/lightdm/lightdm.conf.d/01_debian.conf ]; then
      cat <<EOF > /usr/share/lightdm/lightdm.conf.d/01_debian.conf
[Seat:*]
greeter-session=lightdm-greeter
greeter-hide-users=false
session-wrapper=/etc/X11/Xsession
allow-user-switching=true
EOF
    else
      if [ -f /etc/lightdm/lightdm.conf ]; then
        sed -i '/^#*greeter-hide-users/c\\greeter-hide-users=false' /etc/lightdm/lightdm.conf
        sed -i '/^#*allow-user-switching/c\\allow-user-switching=true' /etc/lightdm/lightdm.conf
      else
        echo -e "No lightdm configuration files found!\\n"
      fi
    fi
  fi

  if [ -f /usr/share/lightdm/lightdm-gtk-greeter.conf.d/01_debian.conf ]; then
    curl -fLksm10 -o /usr/share/images/wallpaper.jpg $WALLPAPER
    sed -i '/background=/c\\background=/usr/share/images/wallpaper.jpg' /usr/share/lightdm/lightdm-gtk-greeter.conf.d/01_debian.conf
  fi
}

function firefox(){
  echo Firefox
  su - $USER -c "mkdir -p $HOME_USER/.local/share/{applications,icons} \\
                          $HOME_USER/.local/bin"

  dpkg -s firefox-esr &> /dev/null && \\
    apt-get remove -y --no-install-recommends firefox-esr > /dev/null

  if [[ ! -d $HOME_USER/.local/share/firefox ]]; then
    curl -Ls $FIREFOX_URL -o /tmp/firefox.tar.xz
    su - $USER -c "tar -xJf /tmp/firefox.tar.xz -C $HOME_USER/.local/share/"
    rm /tmp/firefox.tar.xz
  fi

  chmod a+x $HOME_USER $HOME_USER/.local $HOME_USER/.local/share \\
            $HOME_USER/.local/share/firefox

  ln -fs $HOME_USER/.local/share/firefox/firefox-bin $BIN_DIR/firefox

  update-alternatives --install /usr/bin/x-www-browser x-www-browser "$BIN_DIR"/firefox 10 > /dev/null
  update-alternatives --set x-www-browser "$BIN_DIR"/firefox > /dev/null
  update-alternatives --install /usr/bin/gnome-www-browser gnome-www-browser "$BIN_DIR"/firefox 10 > /dev/null
  update-alternatives --set gnome-www-browser "$BIN_DIR"/firefox > /dev/null

  cat <<EOF > /usr/share/applications/firefox.desktop
[Desktop Entry]
Name=Firefox
Comment=Browse the World Wide Web
GenericName=Web Browser
X-GNOME-FullName=Firefox Web Browser
Exec=$HOME_USER/.local/share/firefox/firefox-bin %u
Terminal=false
X-MultipleArgs=false
Type=Application
Icon=firefox
Categories=Network;WebBrowser;
MimeType=text/html;text/xml;application/xhtml+xml;application/xml;application/vnd.mozilla.xul+xml;application/rss+xml;application/rdf+xml;image/gif;image/jpeg;image/png;x-scheme-handler/http;x-scheme-handler/https;
StartupWMClass=Firefox
StartupNotify=true
EOF
  echo "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" \\
    | base64 --decode > /usr/share/icons/firefox.png
}

function set_vscode(){
  echo vscode
  wget -qO- https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > packages.microsoft.gpg
  install -D -o root -g root -m 644 packages.microsoft.gpg /etc/apt/keyrings/packages.microsoft.gpg
  sudo sh -c 'echo "deb [arch=amd64,arm64,armhf signed-by=/etc/apt/keyrings/packages.microsoft.gpg] https://packages.microsoft.com/repos/code stable main" > /etc/apt/sources.list.d/vscode.list'
  rm -f packages.microsoft.gpg
  package_installer "code"
}


echo ":: INIT - RCALDAS ::"

ask_user
asks
echo -e "\\n\\t>> Working, please wait... <<\\n"


if [[ -n $NEWHOSTNAME ]]; then
  set_hostname
fi

set_dns
set_timezone
set_packages

if [ "$CHANGESSH" == "n" ] || [ "$CHANGESSH" == "N" ]; then
  :
else
  set_ssh
fi

ensure_root_key
set_smtp
set_user
set_tune2fs

if [ "$INSTSYNC" == "y" ] || [ "$INSTSYNC" == "Y" ]; then
  set_syncthing
fi

if [ "$INSTDOCKER" == "y" ] || [ "$INSTDOCKER" == "Y" ]; then
  set_docker
fi

if [ "$ISDESKTOP" == "y" ] || [ "$ISDESKTOP" == "Y" ]; then
  set_swappiness
  set_lightdm
  firefox
  set_vscode
  package_installer "$desktop_apps"
fi

apt-get -qq upgrade > /dev/null
apt-get -qq autoremove > /dev/null
apt-get -qq clean

fastfetch

echo -e "\\n\\t>> Ativando monitoramento/DDNS... <<\\n"
curl -fsSL "${APP_URL}/install" | bash

echo -e "\\n\\t>> Done! <<\\n"
exit 0
`;
}

export async function GET() {
  return new Response(script(), {
    headers: {
      'content-type': 'text/x-shellscript; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
