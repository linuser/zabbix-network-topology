# Zabbix-Frontend fuer das Entwicklungsnetz — mit APCu.
#
# WARUM DIESES IMAGE UEBERHAUPT EXISTIERT
# ---------------------------------------
# Das offizielle zabbix-web-Image bringt kein APCu mit, und ohne APCu ist
# `NtCache` ein No-Op. Das ist nicht nur ein fehlender Cache: die
# Topologie-BASELINE liegt dort. Ohne sie
#
#   * meldet der Diff nie eine Aenderung (kein "Kabel weg", kein "umgesteckt"),
#   * altern Kanten nicht, es gibt also keine gestrichelten Ex-Verbindungen,
#   * und der Diag-Tab zeigt einen leeren Ringpuffer.
#
# Das Entwicklungsnetz konnte damit ausgerechnet die Funktionen nicht
# nachstellen, die 5.4.0 ausmachen. Aufgefallen beim Versuch, die
# Aenderungsmeldung eines ausgefallenen LAG-Mitglieds zu zeigen: sie kam
# nicht, und der Grund war nicht das Modul.
#
# Die PHP-Version haengt am Basis-Image (heute php85). Zieht Zabbix das
# weiter, muss hier die Paketversion mit — das Image baut sonst nicht, und
# das ist die richtige Fehlerrichtung: laut statt still.
FROM zabbix/zabbix-web-nginx-pgsql:alpine-7.0-latest

USER root
RUN apk add --no-cache php85-pecl-apcu \
    && printf 'extension=apcu.so\napc.enable_cli=0\napc.shm_size=64M\n' \
       > /etc/php85/conf.d/99_apcu.ini
USER 1997
