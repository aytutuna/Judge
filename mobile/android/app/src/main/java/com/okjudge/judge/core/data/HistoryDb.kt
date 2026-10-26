package com.okjudge.judge.core.data

import android.content.Context
import androidx.room.AutoMigration
import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

/**
 * One saved verdict. `nameMapJson` is the author's own name map: it never
 * leaves the phone (backups and device transfer are off for the app).
 */
@Entity(tableName = "saved_verdicts")
data class SavedVerdictRow(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    val headline: String,
    val verdict: String,
    val lang: String,
    val confidence: Int,
    val preset: String,
    val tier: String,
    @ColumnInfo(name = "result_json") val resultJson: String,
    @ColumnInfo(name = "name_map_json") val nameMapJson: String,
    /** `{"tr": <VerdictResult JSON>}`: translations fetched so far, for offline use. */
    @ColumnInfo(name = "translations_json") val translationsJson: String? = null,
    /** The verdict shown when context was added later (a round's id); null: the first one. */
    @ColumnInfo(name = "ruling_id") val rulingId: String? = null,
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
}

@Database(entities = [SavedVerdictRow::class], version = 2, exportSchema = true, autoMigrations = [AutoMigration(from = 1, to = 2)])
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
