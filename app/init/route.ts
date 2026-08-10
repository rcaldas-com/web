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
    return `# live/bin ainda nao sincronizado em ${SYNC_BIN_DIR}`;
  }
  const files = entries.filter((e) => e.isFile() && SAFE_FILENAME.test(e.name));
  if (!files.length) return '# nenhum script em live/bin no momento do provisionamento';

  return files
    .map((entry, index) => {
      const content = fs.readFileSync(path.join(SYNC_BIN_DIR, entry.name), 'utf8').replace(/\r\n/g, '\n');
      const delim = `BINFILE_${index}_EOF`;
      return `cat <<'${delim}' > "$BIN_DIR"/${entry.name}\n${content}\n${delim}\nchmod +x "$BIN_DIR"/${entry.name}`;
    })
    .join('\n');
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

  ${binInstallScript}

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
  curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
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
