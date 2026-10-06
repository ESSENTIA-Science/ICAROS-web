FROM debian:bookworm-slim

# Never start package services during the image build. Runtime does not need root.
RUN printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d \
    && chmod 755 /usr/sbin/policy-rc.d \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends squid \
    && rm -rf /var/lib/apt/lists/* /etc/squid/conf.d \
    && rm -f /etc/squid/squid.conf

USER proxy
EXPOSE 3128
ENTRYPOINT ["/usr/sbin/squid", "-N", "-f", "/etc/squid/squid.conf", "-d", "0"]
