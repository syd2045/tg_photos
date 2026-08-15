package com.sydstudio.tguploader

import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.PermissionState
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.util.concurrent.TimeUnit

@CapacitorPlugin(
    name = "TgSync",
    permissions = [
        Permission(strings = ["android.permission.READ_MEDIA_IMAGES"], alias = "photos33"),
        Permission(strings = ["android.permission.READ_EXTERNAL_STORAGE"], alias = "photosLegacy")
    ]
)
class TgSyncPlugin : Plugin() {

    private fun prefs() = context.getSharedPreferences(TgSyncWorker.PREFS, 0)

    // Android 13+ uses READ_MEDIA_IMAGES; older versions use READ_EXTERNAL_STORAGE.
    // Requesting these as one combined alias breaks on newer OS versions since
    // the legacy permission no longer applies there, so we pick the right one
    // for the running device instead.
    private fun activeAlias(): String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) "photos33" else "photosLegacy"

    private fun photosGranted(): Boolean =
        getPermissionState(activeAlias()) == PermissionState.GRANTED

    @PluginMethod
    fun configure(call: PluginCall) {
        val token = call.getString("token") ?: ""
        val chatId = call.getString("chatId") ?: ""

        prefs().edit()
            .putString("token", token)
            .putString("chat_id", chatId)
            .apply()

        call.resolve()
    }

    @PluginMethod
    fun checkPermission(call: PluginCall) {
        val result = JSObject()
        result.put("granted", photosGranted())
        call.resolve(result)
    }

    @PluginMethod
    fun requestStoragePermission(call: PluginCall) {
        if (photosGranted()) {
            val result = JSObject()
            result.put("granted", true)
            call.resolve(result)
            return
        }
        requestPermissionForAlias(activeAlias(), call, "permCallback")
    }

    @PermissionCallback
    private fun permCallback(call: PluginCall) {
        val result = JSObject()
        result.put("granted", photosGranted())
        call.resolve(result)
    }

    @PluginMethod
    fun setAutoSync(call: PluginCall) {
        val enabled = call.getBoolean("enabled") ?: false
        val interval = (call.getInt("intervalMinutes") ?: 15).coerceAtLeast(15)

        prefs().edit()
            .putBoolean("auto_sync_enabled", enabled)
            .putInt("interval_minutes", interval)
            .apply()

        val wm = WorkManager.getInstance(context)

        if (enabled) {
            // First time turning on: baseline to "now" so we don't blast
            // the whole existing gallery into the chat.
            if (!prefs().contains("last_sync_ts")) {
                prefs().edit()
                    .putLong("last_sync_ts", System.currentTimeMillis())
                    .apply()
            }

            val request = PeriodicWorkRequestBuilder<TgSyncWorker>(
                interval.toLong(), TimeUnit.MINUTES
            )
                .setConstraints(
                    androidx.work.Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .build()

            wm.enqueueUniquePeriodicWork(
                TgSyncWorker.UNIQUE_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request
            )
        } else {
            wm.cancelUniqueWork(TgSyncWorker.UNIQUE_NAME)
        }

        call.resolve()
    }

    @PluginMethod
    fun syncNow(call: PluginCall) {
        val request = OneTimeWorkRequestBuilder<TgSyncWorker>().build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork(TgSyncWorker.UNIQUE_NAME + "_manual", ExistingWorkPolicy.REPLACE, request)
        call.resolve()
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        val p = prefs()
        val result = JSObject()
        result.put("enabled", p.getBoolean("auto_sync_enabled", false))
        result.put("intervalMinutes", p.getInt("interval_minutes", 15))
        result.put("lastSyncTime", p.getLong("last_sync_ts", 0L))
        result.put("lastSyncedName", p.getString("last_synced_name", ""))
        result.put("totalSynced", p.getInt("total_synced", 0))
        result.put("hasPermission", photosGranted())

        val selected = p.getStringSet("sync_bucket_ids", null)
        val selectedArray = com.getcapacitor.JSArray()
        selected?.forEach { selectedArray.put(it) }
        result.put("selectedFolderIds", selectedArray)
        result.put("selectedFolderNames", p.getString("sync_bucket_names", ""))

        call.resolve(result)
    }

    @PluginMethod
    fun listFolders(call: PluginCall) {
        if (!photosGranted()) {
            call.reject("Izin galeri belum diberikan")
            return
        }

        val resolver = context.contentResolver
        val collection = android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI

        val projection = arrayOf(
            android.provider.MediaStore.Images.Media.BUCKET_ID,
            android.provider.MediaStore.Images.Media.BUCKET_DISPLAY_NAME
        )

        val counts = LinkedHashMap<String, Pair<String, Int>>()

        resolver.query(collection, projection, null, null, null)?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow(android.provider.MediaStore.Images.Media.BUCKET_ID)
            val nameCol = cursor.getColumnIndexOrThrow(android.provider.MediaStore.Images.Media.BUCKET_DISPLAY_NAME)

            while (cursor.moveToNext()) {
                val id = cursor.getString(idCol) ?: continue
                val name = cursor.getString(nameCol) ?: "Tanpa nama"
                val existing = counts[id]
                counts[id] = name to ((existing?.second ?: 0) + 1)
            }
        }

        val folders = com.getcapacitor.JSArray()
        counts.entries
            .sortedByDescending { it.value.second }
            .forEach { (id, pair) ->
                val obj = JSObject()
                obj.put("id", id)
                obj.put("name", pair.first)
                obj.put("count", pair.second)
                folders.put(obj)
            }

        val result = JSObject()
        result.put("folders", folders)
        call.resolve(result)
    }

    @PluginMethod
    fun setSyncFolders(call: PluginCall) {
        val ids = call.getArray("ids")
        val names = call.getArray("names")

        val idSet = HashSet<String>()
        if (ids != null) {
            for (i in 0 until ids.length()) idSet.add(ids.getString(i))
        }

        val nameList = mutableListOf<String>()
        if (names != null) {
            for (i in 0 until names.length()) nameList.add(names.getString(i))
        }

        val editor = prefs().edit()
        if (idSet.isEmpty()) {
            editor.remove("sync_bucket_ids")
            editor.remove("sync_bucket_names")
        } else {
            editor.putStringSet("sync_bucket_ids", idSet)
            editor.putString("sync_bucket_names", nameList.joinToString(", "))
        }
        editor.apply()

        call.resolve()
    }
}
