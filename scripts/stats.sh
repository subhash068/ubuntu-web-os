#!/bin/bash
echo "---STATS---"
# CPU Load (Using /proc/loadavg instead of top which hangs in WSL)
awk '{print $1 * 10}' /proc/loadavg
# RAM Usage (Used, Total)
free -m | awk '/Mem:/ {print $3,$2}'
# Disk Usage (Used, Total, Percentage)
df -h / | awk 'NR==2 {print $3,$2,$5}'
