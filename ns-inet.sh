#!/usr/bin/env bash

# set -x

if [[ $EUID -ne 0 ]]; then
    echo "You must be root to run this script"
    exit 1
fi

# Returns all available interfaces, except "lo" and "veth*".
available_interfaces()
{
   local ret=()

   local ifaces=$(ip li sh | cut -d " " -f 2 | tr "\n" " ")
   read -a arr <<< "$ifaces" 

   for each in "${arr[@]}"; do
      each=${each::-1}
      if [[ ${each} != "lo" && ${each} != veth* ]]; then
         ret+=( "$each" )
      fi
   done
   echo ${ret[@]}
}

IFACE="$1"
if [[ -z "$IFACE" ]]; then
   ifaces=($(available_interfaces))
   if [[ ${#ifaces[@]} -gt 0 ]]; then
      IFACE=${ifaces[0]}
      echo "Using interface $IFACE"
   else
      echo "Usage: ./ns-inet <IFACE>"
      exit 1
   fi
fi

# First namespace
NS1="ns-rs"
VETH1="host-rs"
VPEER1="peer-rs"
VETH_ADDR1="10.0.0.1"
VPEER_ADDR1="10.0.0.2"

# trap cleanup EXIT

# cleanup()
# {
#    ip li delete ${VETH1} 2>/dev/null
# }

# Remove namespace if it exists.
ip netns del $NS1 &>/dev/null

# Create namespace
ip netns add $NS1

# Create veth link.
ip link add ${VETH1} type veth peer name ${VPEER1}

# Add peer-1 to NS1.
ip link set ${VPEER1} netns $NS1

# Setup IP address of ${VETH1}.
ip addr add ${VETH_ADDR1}/24 dev ${VETH1}
ip link set ${VETH1} up

# Setup IP ${VPEER1}.
ip netns exec $NS1 ip addr add ${VPEER_ADDR1}/24 dev ${VPEER1}
ip netns exec $NS1 ip link set ${VPEER1} up
ip netns exec $NS1 ip link set lo up
ip netns exec $NS1 ip route add default via ${VETH_ADDR1}

# Enable IP-forwarding.
echo 1 > /proc/sys/net/ipv4/ip_forward

# Flush forward rules.
iptables -P FORWARD DROP
iptables -F FORWARD
 
# Flush nat rules.
iptables -t nat -F

# Enable masquerading of 10.200.1.0.
iptables -t nat -A POSTROUTING -s ${VPEER_ADDR1}/24 -o ${IFACE} -j MASQUERADE
 
iptables -A FORWARD -i ${IFACE} -o ${VETH1} -j ACCEPT
iptables -A FORWARD -o ${IFACE} -i ${VETH1} -j ACCEPT

mkdir -p /etc/netns/${NS1} 
echo 'nameserver 8.8.8.8' > /etc/netns/${NS1}/resolv.conf

# To execute manually within the namespace
# export PATH=$PATH:/home/lasse/.cargo/bin

# Get into namespace
# ip netns exec ${NS1} /bin/bash --rcfile <(echo "PS1=\"${NS1}> \"")


# Second namespace
NS2="ns-js"
VETH2="host-js"
VPEER2="peer-js"
VETH_ADDR2="11.0.0.1"
VPEER_ADDR2="11.0.0.2"

# trap cleanup EXIT

# cleanup()
# {
#    ip li delete ${VETH2} 2>/dev/null
# }

# Remove namespace if it exists.
ip netns del $NS2 &>/dev/null

# Create namespace
ip netns add $NS2

# Create veth link.
ip link add ${VETH2} type veth peer name ${VPEER2}

# Add peer-2 to NS2.
ip link set ${VPEER2} netns $NS2

# Setup IP address of ${VETH2}.
ip addr add ${VETH_ADDR2}/24 dev ${VETH2}
ip link set ${VETH2} up

# Setup IP ${VPEER2}.
ip netns exec $NS2 ip addr add ${VPEER_ADDR2}/24 dev ${VPEER2}
ip netns exec $NS2 ip link set ${VPEER2} up
ip netns exec $NS2 ip link set lo up
ip netns exec $NS2 ip route add default via ${VETH_ADDR2}

# Enable IP-forwarding.
# echo 1 > /proc/sys/net/ipv4/ip_forward

# Flush forward rules.
iptables -P FORWARD DROP
iptables -F FORWARD
 
# Flush nat rules.
iptables -t nat -F

# Enable masquerading of 10.200.1.0.
iptables -t nat -A POSTROUTING -s ${VPEER_ADDR2}/24 -o ${IFACE} -j MASQUERADE
 
iptables -A FORWARD -i ${IFACE} -o ${VETH2} -j ACCEPT
iptables -A FORWARD -o ${IFACE} -i ${VETH2} -j ACCEPT

mkdir -p /etc/netns/${NS2}
echo 'nameserver 8.8.8.8' > /etc/netns/${NS2}/resolv.conf


# To execute manually within the namespace in order to run Chromium
# mount -t cgroup2 cgroup2 /sys/fs/cgroup
# mount -t securityfs securityfs /sys/kernel/security/
# mkdir /tmp/chromium-session0
# sudo -u lasse chromium --ignore-certificate-errors --user-data-dir=/tmp/chromium-session0

# Get into namespace
# ip netns exec ${NS2} /bin/bash --rcfile <(echo "PS1=\"${NS2}> \"")

# First application interfaces
APP_VETH1="app-rs"
APP_VETH2="app-js"
APP_VETH_ADDR1="12.0.0.1"
APP_VETH_ADDR2="12.0.0.2"

# Create the veth pair
ip link add ${APP_VETH1} type veth peer name ${APP_VETH2}

# Move the veth interfaces to the namespaces
ip link set ${APP_VETH1} netns ${NS1}
ip link set ${APP_VETH2} netns ${NS2}

# Assign IP addresses to the veth interfaces
ip netns exec ${NS1} ip addr add ${APP_VETH_ADDR1}/24 dev ${APP_VETH1}
ip netns exec ${NS2} ip addr add ${APP_VETH_ADDR2}/24 dev ${APP_VETH2}

# Bring up the veth interfaces
ip netns exec ${NS1} ip link set dev ${APP_VETH1} up
ip netns exec ${NS2} ip link set dev ${APP_VETH2} up



# Third namespace
NS3="ns-js-sub"
VETH3="host-js-sub"
VPEER3="peer-js-sub"
VETH_ADDR3="13.0.0.1"
VPEER_ADDR3="13.0.0.2"

# trap cleanup EXIT

# cleanup()
# {
#    ip li delete ${VETH3} 2>/dev/null
# }

# Remove namespace if it exists.
ip netns del $NS3 &>/dev/null

# Create namespace
ip netns add $NS3

# Create veth link.
ip link add ${VETH3} type veth peer name ${VPEER3}

# Add peer-2 to NS3.
ip link set ${VPEER3} netns $NS3

# Setup IP address of ${VETH3}.
ip addr add ${VETH_ADDR3}/24 dev ${VETH3}
ip link set ${VETH3} up

# Setup IP ${VPEER3}.
ip netns exec $NS3 ip addr add ${VPEER_ADDR3}/24 dev ${VPEER3}
ip netns exec $NS3 ip link set ${VPEER3} up
ip netns exec $NS3 ip link set lo up
ip netns exec $NS3 ip route add default via ${VETH_ADDR3}

# Enable IP-forwarding.
# echo 1 > /proc/sys/net/ipv4/ip_forward

# Flush forward rules.
iptables -P FORWARD DROP
iptables -F FORWARD
 
# Flush nat rules.
iptables -t nat -F

# Enable masquerading of 10.200.1.0.
iptables -t nat -A POSTROUTING -s ${VPEER_ADDR3}/24 -o ${IFACE} -j MASQUERADE
 
iptables -A FORWARD -i ${IFACE} -o ${VETH3} -j ACCEPT
iptables -A FORWARD -o ${IFACE} -i ${VETH3} -j ACCEPT

mkdir -p /etc/netns/${NS3}
echo 'nameserver 8.8.8.8' > /etc/netns/${NS3}/resolv.conf


# To execute manually within the namespace in order to run Chromium
# mount -t cgroup2 cgroup2 /sys/fs/cgroup
# mount -t securityfs securityfs /sys/kernel/security/
# mkdir /tmp/chromium-session1
# sudo -u lasse chromium --ignore-certificate-errors --user-data-dir=/tmp/chromium-session1

# Get into namespace
# ip netns exec ${NS3} /bin/bash --rcfile <(echo "PS1=\"${NS3}> \"")

# Second application interfaces
APP_VETH3="app-rs-sub"
APP_VETH4="app-js-sub"
APP_VETH_ADDR3="14.0.0.1"
APP_VETH_ADDR4="14.0.0.2"

# Create the veth pair
ip link add ${APP_VETH3} type veth peer name ${APP_VETH4}

# Move the veth interfaces to the namespaces
ip link set ${APP_VETH3} netns ${NS1}
ip link set ${APP_VETH4} netns ${NS3}

# Assign IP addresses to the veth interfaces
ip netns exec ${NS1} ip addr add ${APP_VETH_ADDR3}/24 dev ${APP_VETH3}
ip netns exec ${NS3} ip addr add ${APP_VETH_ADDR4}/24 dev ${APP_VETH4}

# Bring up the veth interfaces
ip netns exec ${NS1} ip link set dev ${APP_VETH3} up
ip netns exec ${NS3} ip link set dev ${APP_VETH4} up