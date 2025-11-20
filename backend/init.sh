#!/usr/bin/env bash
set -e

# Patroni chama este script assim:
# post_init.sh dbname=<db> user=<user> host=<host> port=<port>
#
# Portanto, basta repassar todos os parâmetros ($@) para o psql.
# Ele já se conecta com usuário, banco e porta corretos.

psql "$@" -f /etc/post-init.sql
