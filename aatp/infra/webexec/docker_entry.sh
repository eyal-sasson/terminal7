#!/usr/bin/env bash

set -x
EXE="/usr/local/bin/webexec"
HOME=/home/runner
CONF=/conf


/etc/init.d/ssh start
rm -rf $HOME/.local/state/webexec
mkdir -p $HOME/.config/webexec
cp -r $CONF/* /home/runner/.config/webexec
chown -R runner /home/runner
touch /auth/authorized_fingerprints
ln -fs /auth/authorized_fingerprints $HOME/.config/webexec
chown -R runner /home/runner /auth/authorized_fingerprints
# remove this when we solve #83
if [[ $PEERBOOK == "1" ]]
then
    /scripts/wait-for-it.sh -h peerbook -p 17777
fi
su -c "$EXE start --debug" runner
while true
do
    sleep 1
done
