FROM python:3.13-slim
# 1.1.1 ist die aktuelle Fassung; hoehere Nummern gibt es nicht.
RUN pip install --no-cache-dir snmpsim-lextudio==1.1.1 \
 && useradd -r -u 1000 -s /usr/sbin/nologin snmpsim
EXPOSE 1161/udp
# snmpsim besteht auf einem Rechteabwurf, auch auf unprivilegierten Ports.
ENTRYPOINT ["snmpsim-command-responder", "--data-dir=/data", \
            "--agent-udpv4-endpoint=0.0.0.0:1161", \
            "--process-user=snmpsim", "--process-group=snmpsim"]
