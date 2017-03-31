Generate a report on query index usage in a mongo db database.
This was developed especially with `parse-server` in mind.

# Usage

```
Usage: node index.js <mongo-url> <out-dir> [timespan in sec]
```

If timespan is provided only the queries within the last `timespan` seconds will be considered.
