package com.sydstudio.tguploader

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ContentUris
import android.content.Context
import android.os.Build
import android.provider.MediaStore
import androidx.core.app.NotificationCompat
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

class TgSyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    companion object {
        const val PREFS = "tg_native_prefs"
        const val UNIQUE_NAME = "tg_auto_sync_work"
        const val CHANNEL_ID = "tg_sync_channel"
        private const val MAX_PER_RUN = 15
        private const val MAX_TRACKED_IDS = 4000

        // Prevents the periodic auto-sync and the manual "Sync Sekarang"
        // button from ever running at the same time. Without this, both
        // could read the same "not yet uploaded" state and send the same
        // photos twice — this was the spam bug.
        private val SYNC_LOCK = Any()
    }

    override fun doWork(): Result = synchronized(SYNC_LOCK) {
        val prefs = applicationContext.getSharedPreferences(PREFS, 0)

        val token = prefs.getString("token", "") ?: ""
        val chatId = prefs.getString("chat_id", "") ?: ""

        if (token.isEmpty() || chatId.isEmpty()) return Result.success()

        val lastSyncTs = prefs.getLong("last_sync_ts", System.currentTimeMillis())
        val lastSyncSeconds = lastSyncTs / 1000

        // Folder filter — empty/missing set means "semua folder" (sync everything).
        val selectedBuckets = prefs.getStringSet("sync_bucket_ids", null)

        // Already-uploaded MediaStore IDs, kept as a hard guardrail against
        // duplicates even if the time-cursor logic ever races.
        val uploadedIds = HashSet(prefs.getStringSet("uploaded_ids", emptySet()) ?: emptySet())

        val resolver = applicationContext.contentResolver
        val collection = MediaStore.Images.Media.EXTERNAL_CONTENT_URI

        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.DATE_ADDED,
            MediaStore.Images.Media.BUCKET_ID
        )

        val selectionParts = mutableListOf("${MediaStore.Images.Media.DATE_ADDED} > ?")
        val argsList = mutableListOf(lastSyncSeconds.toString())

        if (!selectedBuckets.isNullOrEmpty()) {
            val placeholders = selectedBuckets.joinToString(",") { "?" }
            selectionParts.add("${MediaStore.Images.Media.BUCKET_ID} IN ($placeholders)")
            argsList.addAll(selectedBuckets)
        }

        val selection = selectionParts.joinToString(" AND ")
        val args = argsList.toTypedArray()
        val sort = "${MediaStore.Images.Media.DATE_ADDED} ASC"

        var newestSeconds = lastSyncSeconds
        var syncedCount = 0
        var lastName = ""

        try {
            resolver.query(collection, projection, selection, args, sort)?.use { cursor ->
                val idCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
                val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
                val dateCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED)

                while (cursor.moveToNext() && syncedCount < MAX_PER_RUN) {
                    val id = cursor.getLong(idCol)
                    val idStr = id.toString()
                    val name = cursor.getString(nameCol) ?: "photo_$id.jpg"
                    val dateAdded = cursor.getLong(dateCol)

                    if (dateAdded > newestSeconds) newestSeconds = dateAdded

                    // Already sent before — skip silently, no re-upload.
                    if (uploadedIds.contains(idStr)) continue

                    val uri = ContentUris.withAppendedId(collection, id)

                    val ok = try {
                        resolver.openInputStream(uri)?.use { input ->
                            sendPhotoToTelegram(token, chatId, name, input.readBytes())
                        } ?: false
                    } catch (e: Exception) {
                        false
                    }

                    if (ok) {
                        syncedCount++
                        lastName = name
                        uploadedIds.add(idStr)
                    }
                }
            }
        } catch (e: SecurityException) {
            return Result.failure()
        }

        // Keep the tracked-id set from growing forever.
        val trimmedIds = if (uploadedIds.size > MAX_TRACKED_IDS) {
            uploadedIds.toList().takeLast(MAX_TRACKED_IDS).toSet()
        } else uploadedIds

        prefs.edit()
            .putLong("last_sync_ts", newestSeconds * 1000)
            .putStringSet("uploaded_ids", trimmedIds)
            .apply()

        if (syncedCount > 0) {
            prefs.edit()
                .putString("last_synced_name", lastName)
                .putInt("total_synced", prefs.getInt("total_synced", 0) + syncedCount)
                .apply()

            notifySynced(syncedCount)
        }

        return Result.success()
    }

    private fun sendPhotoToTelegram(token: String, chatId: String, fileName: String, bytes: ByteArray): Boolean {
        val boundary = "----TgSync${UUID.randomUUID()}"
        val url = URL("https://api.telegram.org/bot$token/sendPhoto")
        val conn = url.openConnection() as HttpURLConnection

        return try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
            conn.connectTimeout = 20000
            conn.readTimeout = 60000

            conn.outputStream.use { out ->
                writeField(out, boundary, "chat_id", chatId)
                writeFilePart(out, boundary, "photo", fileName, bytes)
                out.write("--$boundary--\r\n".toByteArray())
            }

            val code = conn.responseCode
            code in 200..299
        } catch (e: Exception) {
            false
        } finally {
            conn.disconnect()
        }
    }

    private fun writeField(out: OutputStream, boundary: String, name: String, value: String) {
        out.write("--$boundary\r\n".toByteArray())
        out.write("Content-Disposition: form-data; name=\"$name\"\r\n\r\n".toByteArray())
        out.write("$value\r\n".toByteArray())
    }

    private fun writeFilePart(out: OutputStream, boundary: String, field: String, fileName: String, bytes: ByteArray) {
        out.write("--$boundary\r\n".toByteArray())
        out.write("Content-Disposition: form-data; name=\"$field\"; filename=\"$fileName\"\r\n".toByteArray())
        out.write("Content-Type: image/jpeg\r\n\r\n".toByteArray())
        out.write(bytes)
        out.write("\r\n".toByteArray())
    }

    private fun notifySynced(count: Int) {
        val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Sinkronisasi Telegram", NotificationManager.IMPORTANCE_LOW)
            manager.createNotificationChannel(channel)
        }

        val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_upload_done)
            .setContentTitle("Foto tersinkron ke Telegram")
            .setContentText("$count foto baru berhasil dikirim")
            .setAutoCancel(true)
            .build()

        try {
            manager.notify(1001, notification)
        } catch (e: SecurityException) {
            // POST_NOTIFICATIONS not granted — sync still succeeded, just silent.
        }
    }
}
