# Media over QUIC

Media over QUIC (MoQ) is a live media delivery protocol utilizing QUIC streams.
See the [MoQ working group](https://datatracker.ietf.org/wg/moq/about/) for more information.

This repository contains the a web library for MoQ.
It uses the browser APIs such as WebTransport and WebCodecs to support both contribution and distribution.
Check out [quic.video](https://quic.video) for a demo or [run it locally](https://github.com/kixelated/quic.video) as a UI.

This is a client only.
You'll either need to run a local server using [moq-rs](https://github.com/kixelated/moq-rs) or use a public server such as [relay.quic.video](https://quic.video/relay).

Join the [Discord](https://discord.gg/FCYF3p99mr) for updates and discussion.

## Setup of our Test Environment

### Installations

-   We run our setup on Ubuntu 24.04 LTS.

-   Install the beta version of the `Chromium` browser, we run version `128.0.6613.27`.

-   Install `node` version `18.19.1` or higher.

-   Install `npm` version `9.2.0` or higher.

-   Install `rustup`.

-   Install `go`.

-   Clone our forks of `moq-js` and `moq-rs`.

### Namespaces

-   Execute the `ns-inet.sh` script with your network interface (get its name by running `ip a`) as first argument in order to create the 3 Linux network namespaces.

-   Run `ip netns` for a list of network namespaces on your device.

### Publisher

Get into `ns-js` namespace by running

```bash
sudo ip netns exec ns-js bash
```

Move into the `moq-js` folder and run

```bash
npm install
```

as well as

```bash
npm run dev
```

Remember to adjust the IP addresses of the network interfaces if you changed them in the `ns-inet.sh` script or if you test under real network conditions.

In another terminal, also get into `ns-js` and open a Chromium browser session by running the following commands replace `$USER` with your user name:

```bash
mount -t cgroup2 cgroup2 /sys/fs/cgroup
```

```bash
mount -t securityfs securityfs /sys/kernel/security/
```

```bash
mkdir /tmp/chromium-session0
```

```bash
sudo -u $USER chromium --ignore-certificate-errors --user-data-dir=/tmp/chromium-session0
```

Then, open `https://12.0.0.2:4321/publish` to publish content.

### Server

As a next step, run the server. To accomplish this, get into the `ns-rs` namespace by running

```bash
sudo ip netns exec ns-rs bash
```

Add `cargo` to the `$PATH` variable

```bash
export PATH=$PATH:/home/$USER/.cargo/bin
```

Move into the `moq-rs` folder and run

```bash
./dev/relay
```

### Remote Subscriber

To run the remote subscriber, get into the respective namespace

```bash
sudo ip netns exec ns-js-sub bash
```

Within `moq-js`, open the `remote-subscriber` branch and run all of the `npm` and Chromium related commands of the `ns-js` namespace, but make sure to replace `chromium-session0` with `chromium-session1`.

Then, open `https://14.0.0.2:4321/watch/$URL_ID` to publish content. Replace `$URL_ID` with the respective unique namespace string that was created when starting the publisher live stream.

### Configuration

-   Stream parameters can be changed at `lib/common/evaluationscenarios.ts`.

-   Network configurations can be changed at `config.json`.

## License

Licensed under either:

-   Apache License, Version 2.0, ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
-   MIT license ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)
