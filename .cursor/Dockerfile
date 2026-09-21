FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

########################################################
# SYSTEM DEPENDENCIES
########################################################

RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    git \
    build-essential \
    python3 \
    sudo \
    && rm -rf /var/lib/apt/lists/*

########################################################
# UBUNTU USER
########################################################

RUN mkdir -p /etc/ssh/sshd_config.d && \
    printf '%s\n' 'PasswordAuthentication no' 'ChallengeResponseAuthentication no' 'UsePAM no' \
    > /etc/ssh/sshd_config.d/disable_password_auth.conf

RUN id -u ubuntu >/dev/null 2>&1 || useradd -m -s /bin/bash ubuntu
RUN usermod -aG sudo ubuntu
RUN echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ubuntu
RUN echo "ubuntu:ubuntu" | chpasswd

RUN printf '%s\n' \
    'export NVM_DIR="/home/ubuntu/.nvm"' \
    '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' \
    '[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"' \
    | tee /etc/profile.d/nvm.sh >> /home/ubuntu/.bashrc

########################################################
# NVM + COREPACK
########################################################

ENV NVM_DIR=/home/ubuntu/.nvm

RUN mkdir -p $NVM_DIR && \
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && \
    . "$NVM_DIR/nvm.sh" && \
    nvm install 24 && \
    corepack enable

RUN chown -R ubuntu:ubuntu $NVM_DIR

########################################################
# AGENTFILES
########################################################

ADD --keep-git-dir=true \
  https://github.com/martindzejky/agentfiles.git#master \
  /home/ubuntu/.agentfiles

RUN mkdir -p /home/ubuntu/.cursor && \
    cd /home/ubuntu/.agentfiles && \
    git submodule update --init --recursive && \
    . "$NVM_DIR/nvm.sh" && \
    HOME=/home/ubuntu ./install

RUN chown -R ubuntu:ubuntu /home/ubuntu

# Workaround: expose ~/.cursor at the filesystem root so Cursor's upward walk finds it
RUN ln -s /home/ubuntu/.cursor /.cursor

########################################################
# NODE PATH (ahead of Cursor exec-daemon Node 22)
########################################################

RUN printf '%s\n' \
    '# Prepend nvm Node 24 ahead of Cursor exec-daemon Node 22.' \
    'export NVM_DIR="${NVM_DIR:-/home/ubuntu/.nvm}"' \
    'if [ -s "$NVM_DIR/nvm.sh" ]; then' \
    '  . "$NVM_DIR/nvm.sh"' \
    '  nvm use 24 >/dev/null 2>&1 || true' \
    '  _ver="$(nvm version 24 2>/dev/null)"' \
    '  if [ -n "$_ver" ] && [ "$_ver" != "N/A" ] && [ -d "$NVM_DIR/versions/node/$_ver/bin" ]; then' \
    '    export PATH="$NVM_DIR/versions/node/$_ver/bin:$PATH"' \
    '  fi' \
    '  unset _ver' \
    'fi' \
    > /etc/profile.d/node-path.sh

ENV BASH_ENV=/etc/profile.d/node-path.sh

########################################################
# SET USER
########################################################

USER ubuntu
WORKDIR /home/ubuntu
