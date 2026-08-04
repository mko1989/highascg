tmux new -s eggs

sudo systemctl stop highascg
sudo bash tools/eggs/live-usb/unmount-usb-for-partitioning.sh /dev/sda
sudo HIGHASCG_NVIDIA_DRIVER=595 bash tools/eggs/live-usb/build-produce-flash-stick.sh --usb /dev/sda -y
sudo systemctl start highascg
