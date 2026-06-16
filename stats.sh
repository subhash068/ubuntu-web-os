#!/bin/bash
echo "---STATS---"
# CPU Load
top -bn1 | grep "Cpu(s)" | sed "s/.*, *\([0-9.]*\)%* id.*/\1/" | awk '{print 100 - $1}'
# RAM Usage (Used, Total)
free -m | awk '/Mem:/ {print $3,$2}'
# Disk Usage (Used, Total, Percentage)
df -h / | awk 'NR==2 {print $3,$2,$5}'
