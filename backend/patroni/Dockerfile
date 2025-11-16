FROM postgres:15

# Instala dependências do Patroni
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        postgresql-15 \
        postgresql-client-15 \
        netcat-openbsd \
        python3-pip \
        python3-psycopg2 \
        python3-yaml
RUN pip3 install --break-system-packages --no-cache-dir patroni[etcd]
RUN pip3 install --no-cache-dir --break-system-packages  etcd3 && \
    rm -rf /var/lib/apt/lists/*

# Copia config principal do Patroni
COPY patroni.yml /etc/patroni.yml
COPY init.sql /etc/post-init.sql

# Define o entrypoint para iniciar o Patroni (ele inicia o Postgres)
USER postgres
CMD ["patroni", "/etc/patroni.yml"]
