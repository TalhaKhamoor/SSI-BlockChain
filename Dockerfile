FROM ubuntu:18.04

#### Needed Packages
RUN apt-get update && \
    apt-get install -y --no-install-recommends\
        add-apt-key \
        apt-transport-https \
        dirmngr \
        ca-certificates  \
        curl \
        software-properties-common \
        vim \
        supervisor \
        netcat \
        nginx \
        libpq-dev \
        gcc \
        make \
        g++ \
        jq \
        python3-pip \
        pwgen

#### Needed Repos
RUN echo "deb https://repo.sovrin.org/sdk/deb xenial stable" > /etc/apt/sources.list.d/sovrin.list && \
    cnt=0 ;\
    while ! apt-key adv --keyserver keyserver.ubuntu.com --recv-keys CE7709D068DB5E88 2>&1; do \
        echo "Waiting 1 second before retrying gpg key download.($cnt/10)" ;\
        sleep 1 ;\
        cnt=$((cnt + 1)); \
        if [ $cnt -ge 10 ] ; then \
            echo "Could not add gpg key. Aborting" ;\
            exit 1 ;\
        fi ;\
    done

#### Install Libindy/Sovtoken and Dependencies
COPY install/* /root/install/
COPY config/* /root/config/
COPY data/* /root/data/
COPY server/ /root/server/
COPY web/* /root/web/

# Add Keys and Update apt-get Libraries:
WORKDIR /root/install
RUN apt-get update && \
    apt-get install -y \
    libindy=1.12.0 \
    libsovtoken=1.0.3
RUN dpkg -i libvcx_*.deb

# NodeJS 8.x install
RUN . /etc/os-release && \
    curl -f -s https://deb.nodesource.com/gpgkey/nodesource.gpg.key | apt-key add - && \
    echo "deb https://deb.nodesource.com/node_8.x ${UBUNTU_CODENAME} main" > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y nodejs --no-install-recommends

#### Cleanup
# clean up apt lists
RUN rm -rf /var/lib/apt/lists/*

COPY config/supervisord.conf /etc/supervisord.conf
#### Entrypoint
ENTRYPOINT [ "/root/install/install-vcx-portal.sh" ]
