package com.okjudge.judge.core.data

import android.content.Context
import androidx.room.AutoMigration
import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

/**
 * One verdict kept on the phone, for offline reading. `nameMapJson` is the
 * author's own name map (backups and device transfer are off for the app);
 * the account holds it too, encrypted. [ownerUserId] is set once the
 * account's list has the verdict; null rows were judged signed out or by an
 * older version and may be on this phone only.
 */
@Entity(tableName = "saved_verdicts")
data class SavedVerdictRow(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    val headline: String,
    val verdict: String,
    val lang: String,
    val confidence: Int,
    /** The judging style there used to be a choice of. Kept so old databases open without a migration. */
    val preset: String = "balanced",
    val tier: String,
    @ColumnInfo(name = "result_json") val resultJson: String,
    @ColumnInfo(name = "name_map_json") val nameMapJson: String,
    /** `{"tr": <VerdictResult JSON>}`: translations fetched so far, for offline use. */
    @ColumnInfo(name = "translations_json") val translationsJson: String? = null,
    /** The verdict shown when context was added later (a round's id); null: the first one. */
    @ColumnInfo(name = "ruling_id") val rulingId: String? = null,
    @ColumnInfo(name = "owner_user_id") val ownerUserId: String? = null,
)

/** A row of the account's Verdicts list as the server last sent it ([json] is the HistoryItem). */
@Entity(
    tableName = "history_rows",
    primaryKeys = ["user_id", "key"],
    indices = [Index(value = ["user_id", "at"])],
)
data class HistoryCacheRow(
    @ColumnInfo(name = "user_id") val userId: String,
    val key: String,
    val kind: String,
    @ColumnInfo(name = "item_id") val itemId: String,
    val at: String,
    val json: String,
)

@Dao
interface HistoryDao {
    @Query("SELECT * FROM saved_verdicts ORDER BY created_at DESC")
    fun observeAll(): Flow<List<SavedVerdictRow>>

    @Query("SELECT * FROM saved_verdicts WHERE id = :id")
    fun observe(id: String): Flow<SavedVerdictRow?>

    @Query("SELECT * FROM saved_verdicts WHERE id = :id")
    suspend fun get(id: String): SavedVerdictRow?

    @Upsert
    suspend fun upsert(row: SavedVerdictRow)

    @Query("UPDATE saved_verdicts SET translations_json = :json WHERE id = :id")
    suspend fun setTranslations(id: String, json: String?)

    @Query("DELETE FROM saved_verdicts WHERE id = :id")
    suspend fun delete(id: String)

    @Query("DELETE FROM saved_verdicts")
    suspend fun deleteAll()

    @Query("SELECT * FROM history_rows WHERE user_id = :user ORDER BY at DESC, `key` DESC")
    fun observeCached(user: String): Flow<List<HistoryCacheRow>>

    @Query("SELECT * FROM history_rows WHERE user_id = :user")
    suspend fun cached(user: String): List<HistoryCacheRow>

    @Query("SELECT * FROM history_rows WHERE user_id = :user AND `key` = :key")
    suspend fun cachedRow(user: String, key: String): HistoryCacheRow?

    @Upsert
    suspend fun upsertCached(rows: List<HistoryCacheRow>)

    @Query("DELETE FROM history_rows WHERE user_id = :user AND `key` IN (:keys)")
    suspend fun deleteCached(user: String, keys: List<String>)

    @Query("SELECT user_id FROM history_rows LIMIT 1")
    suspend fun anyCachedUser(): String?

    @Query("UPDATE saved_verdicts SET owner_user_id = :user WHERE id = :id AND owner_user_id IS NULL")
    suspend fun claimSaved(id: String, user: String)

    @Query("DELETE FROM history_rows WHERE user_id <> :user")
    suspend fun deleteCachedOfOthers(user: String)

    @Query("DELETE FROM saved_verdicts WHERE owner_user_id IS NOT NULL AND owner_user_id <> :user")
    suspend fun deleteSavedOfOthers(user: String)

    @Query("DELETE FROM history_rows")
    suspend fun deleteAllCached()

    @Query("DELETE FROM saved_verdicts WHERE owner_user_id IS NOT NULL")
    suspend fun deleteSavedOfAccounts()
}

@Database(
    entities = [SavedVerdictRow::class, HistoryCacheRow::class],
    version = 3,
    exportSchema = true,
    autoMigrations = [AutoMigration(from = 1, to = 2), AutoMigration(from = 2, to = 3)],
)
abstract class HistoryDb : RoomDatabase() {
    abstract fun history(): HistoryDao

    companion object {
        const val NAME = "history.db"

        fun create(context: Context): HistoryDb =
            Room.databaseBuilder(context.applicationContext, HistoryDb::class.java, NAME).build()

        fun inMemory(context: Context): HistoryDb =
            Room.inMemoryDatabaseBuilder(context.applicationContext, HistoryDb::class.java)
                .allowMainThreadQueries()
                .build()
    }
}
