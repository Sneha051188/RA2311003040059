# Notification System Design

> **Author:** RA2311003040059  
> **Stack:** Node.js Backend  
> **Date:** 2026-05-02

---

## Table of Contents

1. [Stage 1 – REST API Design](#stage-1--rest-api-design)
2. [Stage 2 – Database Design](#stage-2--database-design)
3. [Stage 3 – Query Optimisation & Indexing](#stage-3--query-optimisation--indexing)
4. [Stage 4 – Performance Improvements](#stage-4--performance-improvements)
5. [Stage 5 – Scalable `notify_all` System](#stage-5--scalable-notify_all-system)
6. [Stage 6 – Top-N Priority System](#stage-6--top-n-priority-system)

---

## Stage 1 – REST API Design

### Overview

The notification service exposes a RESTful HTTP API. All endpoints are versioned under `/api/v1/` and require a valid `Authorization: Bearer <token>` header except where noted.

---

### Endpoints

#### `POST /api/v1/notifications`

Create and broadcast a new notification.

**Request Headers**

```
Content-Type: application/json
Authorization: Bearer <access_token>
```

**Request Body**

```json
{
  "type": "Placement",
  "title": "Dream Company Drive – Round 2 Results",
  "message": "Congratulations! You have been shortlisted for the next round.",
  "targetAudience": "all",
  "metadata": {
    "companyId": "c-9821",
    "roundNumber": 2
  }
}
```

| Field            | Type   | Required | Description                                  |
|------------------|--------|----------|----------------------------------------------|
| `type`           | string | ✅        | `Placement` \| `Result` \| `Event`           |
| `title`          | string | ✅        | Short heading of the notification             |
| `message`        | string | ✅        | Full notification body                        |
| `targetAudience` | string | ✅        | `all` \| `batch:<year>` \| `user:<id>`       |
| `metadata`       | object | ❌        | Arbitrary key-value pairs for context        |

**Success Response – `201 Created`**

```json
{
  "status": "success",
  "data": {
    "notificationId": "ntf-00412",
    "type": "Placement",
    "title": "Dream Company Drive – Round 2 Results",
    "message": "Congratulations! You have been shortlisted for the next round.",
    "targetAudience": "all",
    "createdAt": "2026-05-02T10:30:00.000Z",
    "metadata": {
      "companyId": "c-9821",
      "roundNumber": 2
    }
  }
}
```

**Error Response – `400 Bad Request`**

```json
{
  "status": "error",
  "code": "VALIDATION_ERROR",
  "message": "Field 'type' must be one of: Placement, Result, Event"
}
```

---

#### `GET /api/v1/notifications`

Retrieve a paginated, prioritised list of notifications for the authenticated user.

**Request Headers**

```
Authorization: Bearer <access_token>
```

**Query Parameters**

| Param    | Type    | Default | Description                            |
|----------|---------|---------|----------------------------------------|
| `page`   | integer | `1`     | Page number (1-indexed)               |
| `limit`  | integer | `10`    | Items per page (max 100)              |
| `type`   | string  | `all`   | Filter by notification type           |
| `unread` | boolean | `false` | Return only unread notifications      |

**Example Request**

```
GET /api/v1/notifications?page=1&limit=10&type=Placement
```

**Success Response – `200 OK`**

```json
{
  "status": "success",
  "pagination": {
    "currentPage": 1,
    "totalPages": 4,
    "totalCount": 38,
    "limit": 10
  },
  "data": [
    {
      "notificationId": "ntf-00412",
      "type": "Placement",
      "title": "Dream Company Drive – Round 2 Results",
      "message": "Congratulations! You have been shortlisted.",
      "isRead": false,
      "priorityScore": 30,
      "createdAt": "2026-05-02T10:30:00.000Z"
    }
  ]
}
```

---

#### `PATCH /api/v1/notifications/:id/read`

Mark a specific notification as read.

**Request Headers**

```
Authorization: Bearer <access_token>
```

**Success Response – `200 OK`**

```json
{
  "status": "success",
  "data": {
    "notificationId": "ntf-00412",
    "isRead": true,
    "readAt": "2026-05-02T11:00:00.000Z"
  }
}
```

---

#### `GET /api/v1/notifications/top`

Returns the top N highest-priority notifications for the current user.

**Query Parameters**

| Param | Type    | Default | Description           |
|-------|---------|---------|-----------------------|
| `n`   | integer | `10`    | Number of results     |

**Success Response – `200 OK`**

```json
{
  "status": "success",
  "data": [
    {
      "notificationId": "ntf-00412",
      "type": "Placement",
      "priorityScore": 1746176230,
      "title": "Dream Company Drive – Round 2 Results",
      "createdAt": "2026-05-02T10:30:00.000Z"
    }
  ]
}
```

---

## Stage 2 – Database Design

### SQL vs NoSQL Decision

| Criterion              | SQL (PostgreSQL)                  | NoSQL (MongoDB)              |
|------------------------|-----------------------------------|------------------------------|
| Schema flexibility     | Rigid (migrations required)       | Dynamic (easy schema changes)|
| Query complexity       | Rich JOINs, aggregations          | Limited cross-collection ops |
| ACID compliance        | Full                              | Partial (transactions added) |
| Horizontal scaling     | Harder (read replicas)            | Native sharding              |
| Read/Write pattern     | Mixed                             | Write-heavy, read-heavy      |
| Indexing               | Excellent composite indexes       | Good single-field indexes    |

**Decision: PostgreSQL**

Notifications have a consistent, well-understood schema (type, user, timestamp, read-status). We need:
- Complex queries (e.g. "top Placement notifications in last 7 days")
- ACID guarantees (exactly-once delivery tracking)
- Foreign key constraints between users and notifications

PostgreSQL fits these requirements with high performance via proper indexing.

---

### Schema Design

```sql
-- Users table (reference)
CREATE TABLE users (
  user_id     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email       VARCHAR(255) UNIQUE NOT NULL,
  name        VARCHAR(100) NOT NULL,
  batch_year  INTEGER      NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Notifications table
CREATE TABLE notifications (
  notification_id  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  type             VARCHAR(20)  NOT NULL CHECK (type IN ('Placement', 'Result', 'Event')),
  title            VARCHAR(255) NOT NULL,
  message          TEXT         NOT NULL,
  target_audience  VARCHAR(50)  NOT NULL DEFAULT 'all',
  metadata         JSONB,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- User-Notification delivery/read tracking
CREATE TABLE user_notifications (
  id               BIGSERIAL    PRIMARY KEY,
  user_id          UUID         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  notification_id  UUID         NOT NULL REFERENCES notifications(notification_id) ON DELETE CASCADE,
  is_read          BOOLEAN      NOT NULL DEFAULT FALSE,
  read_at          TIMESTAMPTZ,
  delivered_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, notification_id)
);
```

**Design Rationale**
- `notifications` stores the canonical event (written once, read many times)
- `user_notifications` is the fan-out delivery table (one row per recipient)
- `JSONB` for `metadata` allows flexible domain-specific fields without schema changes
- UUID primary keys are globally unique and safe for distributed systems
- `CHECK` constraint on `type` enforces business rules at the database level

---

## Stage 3 – Query Optimisation & Indexing

### The Problem

A naive query for recent notifications with no indexing results in a full sequential scan across potentially millions of rows.

**Slow query (no index):**

```sql
-- Full table scan: O(n) cost
SELECT *
FROM user_notifications un
JOIN notifications n ON un.notification_id = n.notification_id
WHERE un.user_id = $1
ORDER BY n.created_at DESC;
```

### Indexing Strategy

```sql
-- 1. Composite index: filter by user AND sort by notification delivery time
CREATE INDEX idx_un_user_delivered
  ON user_notifications (user_id, delivered_at DESC);

-- 2. Index on notification type for type-filtered queries
CREATE INDEX idx_notif_type_created
  ON notifications (type, created_at DESC);

-- 3. Partial index: only unread notifications (smaller, faster for unread queries)
CREATE INDEX idx_un_unread
  ON user_notifications (user_id, delivered_at DESC)
  WHERE is_read = FALSE;

-- 4. Index on notifications.created_at for date-range queries
CREATE INDEX idx_notif_created_at
  ON notifications (created_at DESC);
```

### Why You Should NOT Index Every Column

Indexing every column is a common anti-pattern with serious downsides:

| Problem                  | Explanation                                                                           |
|--------------------------|---------------------------------------------------------------------------------------|
| **Write slowdown**       | Every `INSERT`/`UPDATE`/`DELETE` must update all indexes → 10+ indexes = 10× write cost |
| **Storage overhead**     | Each B-Tree index can consume as much space as the table itself                      |
| **Planner confusion**    | The query planner may choose a suboptimal index if too many exist                    |
| **Maintenance cost**     | `VACUUM`, `ANALYZE`, and `REINDEX` all take longer                                   |
| **Diminishing returns**  | Low-cardinality columns (e.g. boolean `is_read`) are poor index candidates           |

**Rule of thumb:** Only index columns that appear in `WHERE`, `ORDER BY`, or `JOIN` clauses in frequent, performance-critical queries.

### Query: Last 7 Days Placement Notifications

```sql
-- Optimised: uses idx_notif_type_created and idx_un_user_delivered
SELECT
  n.notification_id,
  n.type,
  n.title,
  n.message,
  n.created_at,
  un.is_read,
  un.delivered_at
FROM user_notifications un
JOIN notifications n
  ON un.notification_id = n.notification_id
WHERE
  un.user_id   = $1                                          -- specific user
  AND n.type   = 'Placement'                                 -- Placement only
  AND n.created_at >= NOW() - INTERVAL '7 days'              -- last 7 days
ORDER BY
  n.created_at DESC;
```

**Execution plan hint:** The planner will use `idx_notif_type_created` to narrow to Placement rows within 7 days, then use `idx_un_user_delivered` to join the user's delivery records — both index scans, no sequential scan.

---

## Stage 4 – Performance Improvements

### 1. Caching with Redis

**Problem:** The top-10 priority list is computed on every request, touching many rows.

**Solution:** Cache the computed top-10 list per user in Redis with a short TTL.

```
Architecture:
  Client → API Server → Redis Cache
                            ↓ (miss)
                        PostgreSQL
```

```js
// Pseudocode — cache-aside pattern
async function getTop10(userId) {
  const cacheKey = `top10:${userId}`;
  const cached   = await redis.get(cacheKey);

  if (cached) return JSON.parse(cached);        // Cache HIT

  const results = await db.queryTop10(userId);   // Cache MISS
  await redis.setEx(cacheKey, 60, JSON.stringify(results)); // TTL = 60s
  return results;
}
```

- **Cache invalidation:** Invalidate `top10:<userId>` whenever a new notification is delivered to that user.
- **TTL:** 60 seconds is a reasonable balance between freshness and load reduction.

---

### 2. Pagination

Return results in pages instead of all at once. This is already designed into the API:

```
GET /api/v1/notifications?page=2&limit=10
```

**DB-level pagination using cursor (keyset pagination):**

```sql
-- More efficient than OFFSET for large datasets
SELECT notification_id, created_at, title
FROM notifications
WHERE created_at < $1            -- cursor: last seen created_at
  AND type = 'Placement'
ORDER BY created_at DESC
LIMIT 10;
```

Keyset pagination avoids the `OFFSET n` penalty (which still scans all preceding rows).

---

### 3. Lazy Loading

**Client-side:** Fetch only visible notifications; load the next batch when the user scrolls to the bottom (infinite scroll).

**Server-side:** Use `SELECT` with only required columns rather than `SELECT *`. Avoid loading `metadata` JSONB unless the user opens a notification detail view.

```sql
-- Lightweight list query (no metadata)
SELECT notification_id, type, title, is_read, delivered_at
FROM user_notifications un
JOIN notifications n USING (notification_id)
WHERE un.user_id = $1
ORDER BY delivered_at DESC
LIMIT 10;
```

---

### 4. Batching

**Problem:** Sending 100,000 push notifications one by one creates 100,000 HTTP round-trips.

**Solution:** Batch-insert delivery records and use message queue fan-out.

```js
// Batch insert to user_notifications
await db.query(
  `INSERT INTO user_notifications (user_id, notification_id)
   SELECT unnest($1::uuid[]), $2`,
  [userIds, notificationId]          // single query for all recipients
);
```

For push delivery (FCM/APNs), use their native batch-send APIs which accept up to 500 tokens per call.

---

## Stage 5 – Scalable `notify_all` System

### Problem with Naive `notify_all`

A synchronous loop over all users is fragile:

```js
// ❌ Naive — blocks the event loop, no retry, no fault tolerance
for (const user of allUsers) {
  await sendPushNotification(user.deviceToken, message);
}
```

**Failure modes:** If the push service is down midway, half the users get the notification. No retry. No observability.

---

### Redesigned Architecture

```
                                    ┌──────────────────────┐
  POST /notifications      ─────▶  │  API Server           │
                                    │  (Producer)           │
                                    └──────────┬───────────┘
                                               │ publish event
                                               ▼
                                    ┌──────────────────────┐
                                    │  Message Queue        │
                                    │  (RabbitMQ / Kafka)   │
                                    └──────────┬───────────┘
                                               │ consume
                              ┌────────────────┼────────────────┐
                              ▼                ▼                ▼
                         Worker 1          Worker 2         Worker N
                        (batch A)         (batch B)        (batch C)
                              │                │                │
                              ▼                ▼                ▼
                         Push Service     Push Service     Push Service
                         (FCM/APNs)       (FCM/APNs)       (FCM/APNs)
```

**Component Responsibilities:**

| Component       | Role                                                                |
|-----------------|---------------------------------------------------------------------|
| API Server      | Validates request, persists to DB, publishes to queue. Returns 202 |
| Message Queue   | Decouples producers from consumers; ensures durability              |
| Worker Pool     | Consumes tasks, sends push, updates delivery status                 |
| Dead Letter Queue (DLQ) | Receives failed messages after N retries for investigation |

---

### Message Schema (Kafka/RabbitMQ)

```json
{
  "eventId": "evt-7712",
  "notificationId": "ntf-00412",
  "type": "Placement",
  "title": "Dream Company Drive",
  "message": "Round 2 results are out.",
  "targetAudience": "all",
  "batchNumber": 1,
  "userIdBatch": ["uid-001", "uid-002", "…"],
  "publishedAt": "2026-05-02T10:30:00.000Z"
}
```

---

### Retry Mechanism

```
Attempt 1 ──▶ Fail ──▶ Wait 5s  ──▶ Attempt 2
                                Fail ──▶ Wait 25s ──▶ Attempt 3
                                                   Fail ──▶ Dead Letter Queue
```

**Exponential back-off:** `delay = baseDelay * 2^(attempt - 1)` with jitter to prevent thundering-herd on retry waves.

**RabbitMQ implementation sketch:**

```js
channel.consume(QUEUE_NAME, async (msg) => {
  try {
    const payload = JSON.parse(msg.content.toString());
    await sendPushBatch(payload.userIdBatch, payload);
    channel.ack(msg);                       // Mark as successfully processed
  } catch (err) {
    const headers  = msg.properties.headers || {};
    const attempts = (headers["x-retry-count"] || 0) + 1;

    if (attempts < MAX_RETRIES) {
      // Re-queue with incremented retry counter and delay
      setTimeout(() => {
        channel.publish("", QUEUE_NAME, msg.content, {
          headers: { "x-retry-count": attempts },
        });
        channel.ack(msg);
      }, Math.pow(2, attempts) * 5000);     // Exponential back-off
    } else {
      // Exhausted retries → send to DLQ for investigation
      channel.publish("", DEAD_LETTER_QUEUE, msg.content);
      channel.ack(msg);
    }
  }
});
```

---

### Fault Tolerance Checklist

- ✅ Queue is durable (survives broker restarts)
- ✅ Messages are persistent (written to disk)
- ✅ Workers are horizontally scalable (add more consumers under load)
- ✅ DLQ captures permanently failing messages for manual replay
- ✅ Idempotency key (`eventId`) prevents double-delivery on worker restart
- ✅ API returns `202 Accepted` immediately (async fan-out)

---

## Stage 6 – Top-N Priority System

### Problem Statement

Given a stream of incoming notifications, efficiently maintain and return the top N highest-priority items at any point in time without re-sorting the full list on every query.

---

### Priority Score Formula

```
Priority = TypeWeight + RecencyScore

TypeWeight:
  Placement → 30
  Result    → 20
  Event     → 10

RecencyScore:
  Unix epoch in seconds of the notification's createdAt timestamp
  (newer = larger value = higher score)
```

---

### Efficient Data Structure: Min-Heap of Size N

A **min-heap** (priority queue) of fixed size N provides:

| Operation         | Time Complexity |
|-------------------|-----------------|
| Insert            | O(log N)        |
| Get top N         | O(N log N) → O(1) if heap already built |
| Maintain top N    | O(log N) per new notification |

**Algorithm:**

```
1. Initialise an empty min-heap of max size N.

2. For each incoming notification:
   a. Compute its priority score.
   b. If heap.size < N:
        Push to heap.
   c. Else if score > heap.peek() (root = minimum of top-N):
        heap.pop()       ← remove the lowest-priority item in top-N
        heap.push(score) ← add the new higher-priority item

3. To retrieve top N:
   Return all elements in the heap (sorted if needed).
```

**Why a min-heap (not max-heap)?**

The min-heap's root is always the *smallest* priority in the current top-N. A new item only displaces the root if it has a *higher* priority — making the comparison O(1) and the replacement O(log N).

---

### JavaScript Implementation

```js
/**
 * MinHeap — O(log n) insert/extract
 * Stores { score, notification } pairs; ordered by score ascending.
 */
class MinHeap {
  constructor() { this.heap = []; }

  get size()  { return this.heap.length; }
  peek()      { return this.heap[0]; }

  push(item) {
    this.heap.push(item);
    this._bubbleUp(this.heap.length - 1);
  }

  pop() {
    const min = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._siftDown(0);
    }
    return min;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.heap[parent].score <= this.heap[i].score) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  _siftDown(i) {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.heap[l].score < this.heap[smallest].score) smallest = l;
      if (r < n && this.heap[r].score < this.heap[smallest].score) smallest = r;
      if (smallest === i) break;
      [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
      i = smallest;
    }
  }
}

/**
 * Maintain top-N notifications from a stream.
 *
 * @param {Array}  notifications - Incoming notification objects
 * @param {number} N             - How many top items to keep
 * @returns {Array}              - Top N notifications, highest priority first
 */
function getTopN(notifications, N = 10) {
  const heap = new MinHeap();

  for (const notif of notifications) {
    const score = computePriority(notif);   // TypeWeight + RecencyScore

    if (heap.size < N) {
      heap.push({ score, notif });
    } else if (score > heap.peek().score) {
      heap.pop();
      heap.push({ score, notif });
    }
  }

  // Extract and sort descending for output
  return heap.heap
    .map(({ score, notif }) => ({ ...notif, priorityScore: score }))
    .sort((a, b) => b.priorityScore - a.priorityScore);
}
```

---

### Handling a Live Stream

For real-time notification streams (WebSocket / Server-Sent Events):

```
Incoming notification
        │
        ▼
  Compute priority score
        │
        ▼
  Is score > heap.peek()?
   YES → pop min, push new   → O(log N)
   NO  → discard             → O(1)
        │
        ▼
  Client polls GET /top?n=10 → return heap contents in O(N log N)
```

**Redis Sorted Set alternative (for distributed systems):**

Redis natively supports sorted sets with O(log N) insertion and O(N) range retrieval:

```
ZADD top_notifications <priority_score> <notification_id>
ZREVRANGE top_notifications 0 9 WITHSCORES   ← top 10
```

This approach works across multiple server instances without in-memory state.

---

*End of Notification System Design Document*
