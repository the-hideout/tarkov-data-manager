# Grafana 📊

Some sample queries to check which cache keys are being used the most:

```ini
count_over_time({app="fastapi"} |= `/api/cache` | regexp `((?P<key>key=.*))\sHTTP` | line_format "{{.key}}"[7d])
```
