$box_name = "CovidInstallToolkit"
Vagrant.configure(2) do |config|
  config.vm.define $box_name do |box|
    config.vm.box = "ubuntu/bionic64"
    box.vm.host_name = $box_name + ".evernym.lab"
    box.vm.network 'private_network', ip: "172.28.128.99"
    box.vm.provider "virtualbox" do |vb|
      vb.name   = $box_name
      vb.gui    = false
      vb.memory = 1024
      vb.cpus   = 1
    end
    config.vm.synced_folder "./", "/vagrant"
end
end
