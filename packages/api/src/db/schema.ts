import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core'

// Phase 0: a minimal key/value table that anchors the migration system and holds
// small idempotent boot state (e.g. schema_version).
export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
export type AppMetaRow = typeof appMeta.$inferSelect

// Phase 1 — Auth & users (data model §2). Booleans are stored as 0/1 integers.
// `must_change_password` is an addition to the spec's `users` DDL so the bootstrap
// admin (and admin-reset users) can be forced to set a new password — see ADR 0002
// and the note added to docs/03-data-model.md.
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'user'] }).notNull(),
  canRunCommands: integer('can_run_commands').notNull().default(0),
  disabled: integer('disabled').notNull().default(0),
  mustChangePassword: integer('must_change_password').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})
export type UserRow = typeof users.$inferSelect

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(), // opaque high-entropy token, also the cookie value
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    userAgent: text('user_agent'),
    revoked: integer('revoked').notNull().default(0),
  },
  (t) => ({
    userIdx: index('idx_sessions_user').on(t.userId),
  }),
)
export type SessionRow = typeof sessions.$inferSelect

// Phase 2 — Repositories, media, categories, jobs (data model §2 + §4).
export const repositories = sqliteTable('repositories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  rootPath: text('root_path').notNull(),
  type: text('type', { enum: ['video', 'image', 'mixed'] }).notNull(),
  enabled: integer('enabled').notNull().default(1),
  readOnly: integer('read_only').notNull().default(1),
  status: text('status', {
    enum: ['unknown', 'online', 'offline', 'scanning', 'error'],
  })
    .notNull()
    .default('unknown'),
  lastScanAt: integer('last_scan_at'),
  lastError: text('last_error'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})
export type RepositoryRow = typeof repositories.$inferSelect

export const mediaItems = sqliteTable(
  'media_items',
  {
    id: text('id').primaryKey(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    relPath: text('rel_path').notNull(),
    type: text('type', { enum: ['video', 'image'] }).notNull(),
    title: text('title').notNull(),
    ext: text('ext').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    fileMtime: integer('file_mtime').notNull(),
    contentHash: text('content_hash'),
    durationS: real('duration_s'),
    width: integer('width'),
    height: integer('height'),
    frameRate: real('frame_rate'),
    bitrate: integer('bitrate'),
    container: text('container'),
    videoCodec: text('video_codec'),
    audioCodec: text('audio_codec'),
    audioTracks: integer('audio_tracks').default(0),
    hasEmbeddedSubs: integer('has_embedded_subs').notNull().default(0),
    capturedAt: integer('captured_at'),
    orientation: integer('orientation'),
    posterPath: text('poster_path'),
    spritePath: text('sprite_path'),
    playbackMode: text('playback_mode', { enum: ['direct', 'hls'] }),
    status: text('status', { enum: ['active', 'offline', 'missing'] })
      .notNull()
      .default('active'),
    addedAt: integer('added_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    repoRelUnique: uniqueIndex('idx_items_repo_rel').on(t.repositoryId, t.relPath),
    repoIdx: index('idx_items_repo').on(t.repositoryId),
    typeIdx: index('idx_items_type').on(t.type),
    addedIdx: index('idx_items_added').on(t.addedAt),
    durationIdx: index('idx_items_duration').on(t.durationS),
    statusIdx: index('idx_items_status').on(t.status),
  }),
)
export type MediaItemRow = typeof mediaItems.$inferSelect

export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): AnySQLiteColumn => categories.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    path: text('path').notNull(),
    depth: integer('depth').notNull(),
    itemCount: integer('item_count').notNull().default(0),
  },
  (t) => ({
    repoPathUnique: uniqueIndex('idx_categories_repo_path').on(t.repositoryId, t.path),
    parentIdx: index('idx_categories_parent').on(t.parentId),
  }),
)
export type CategoryRow = typeof categories.$inferSelect

export const mediaCategories = sqliteTable(
  'media_categories',
  {
    mediaItemId: text('media_item_id')
      .notNull()
      .references(() => mediaItems.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    isLeaf: integer('is_leaf').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.mediaItemId, t.categoryId] }),
    catIdx: index('idx_mediacat_cat').on(t.categoryId),
  }),
)
export type MediaCategoryRow = typeof mediaCategories.$inferSelect

// User-defined tags: a free-form labeling layer over media, independent of on-disk folders. Lets
// items belong to many overlapping groups (and lets AND-combining tags carve out sub-groups)
// without moving files. Tags are global (shared across repositories).
export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    color: text('color'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    nameUnique: uniqueIndex('idx_tags_name').on(t.name),
  }),
)
export type TagRow = typeof tags.$inferSelect

export const mediaTags = sqliteTable(
  'media_tags',
  {
    mediaItemId: text('media_item_id')
      .notNull()
      .references(() => mediaItems.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.mediaItemId, t.tagId] }),
    tagIdx: index('idx_media_tags_tag').on(t.tagId),
  }),
)
export type MediaTagRow = typeof mediaTags.$inferSelect

export const subtitleTracks = sqliteTable(
  'subtitle_tracks',
  {
    id: text('id').primaryKey(),
    mediaItemId: text('media_item_id')
      .notNull()
      .references(() => mediaItems.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['embedded', 'sidecar'] }).notNull(),
    language: text('language'),
    label: text('label'),
    format: text('format'),
    streamIndex: integer('stream_index'),
    relPath: text('rel_path'),
  },
  (t) => ({
    itemIdx: index('idx_subs_item').on(t.mediaItemId),
  }),
)
export type SubtitleTrackRow = typeof subtitleTracks.$inferSelect

// Phase 5 — likes & collections (data model §3). Per-user (FR-61).
export const likes = sqliteTable(
  'likes',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaItemId: text('media_item_id')
      .notNull()
      .references(() => mediaItems.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.mediaItemId] }),
    itemIdx: index('idx_likes_item').on(t.mediaItemId),
  }),
)
export type LikeRow = typeof likes.$inferSelect

export const collections = sqliteTable('collections', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  coverItemId: text('cover_item_id').references(() => mediaItems.id, { onDelete: 'set null' }),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})
export type CollectionRow = typeof collections.$inferSelect

export const collectionItems = sqliteTable(
  'collection_items',
  {
    collectionId: text('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    mediaItemId: text('media_item_id')
      .notNull()
      .references(() => mediaItems.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    addedAt: integer('added_at').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.collectionId, t.mediaItemId] }),
  }),
)
export type CollectionItemRow = typeof collectionItems.$inferSelect

// Phase 9 — custom commands & automation (data model §4). Security-critical (security §5).
export const commands = sqliteTable('commands', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  executable: text('executable').notNull(), // allowlisted binary/abs path; never form input
  argTemplate: text('arg_template').notNull(), // JSON array of tokens (data model §5)
  workingDir: text('working_dir'), // must resolve within an allowed root
  timeoutS: integer('timeout_s').notNull().default(600),
  maxOutputKb: integer('max_output_kb').notNull().default(1024),
  maxConcurrent: integer('max_concurrent').notNull().default(1),
  envAllowlist: text('env_allowlist').notNull().default('[]'), // JSON array of env var names
  allowNonAdmin: integer('allow_non_admin').notNull().default(0),
  enabled: integer('enabled').notNull().default(1),
  isInternal: integer('is_internal').notNull().default(0),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})
export type CommandRow = typeof commands.$inferSelect

export const commandParams = sqliteTable(
  'command_params',
  {
    id: text('id').primaryKey(),
    commandId: text('command_id')
      .notNull()
      .references(() => commands.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    label: text('label').notNull(),
    type: text('type', { enum: ['string', 'number', 'boolean', 'enum', 'repo_path'] }).notNull(),
    required: integer('required').notNull().default(0),
    defaultValue: text('default_value'),
    constraints: text('constraints'), // JSON: {min,max,pattern,options[],repoId,mustBeDir}
    position: integer('position').notNull(),
  },
  (t) => ({
    cmdNameUnique: uniqueIndex('idx_command_params_cmd_name').on(t.commandId, t.name),
  }),
)
export type CommandParamRow = typeof commandParams.$inferSelect

export const commandRuns = sqliteTable(
  'command_runs',
  {
    id: text('id').primaryKey(),
    commandId: text('command_id')
      .notNull()
      .references(() => commands.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    args: text('args').notNull(), // JSON of submitted values
    resolvedArgv: text('resolved_argv').notNull(), // JSON of the actual argv used (audit)
    status: text('status', {
      enum: ['queued', 'running', 'succeeded', 'failed', 'canceled', 'timeout'],
    }).notNull(),
    exitCode: integer('exit_code'),
    outputPath: text('output_path'),
    outputText: text('output_text'),
    truncated: integer('truncated').notNull().default(0),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    cmdIdx: index('idx_runs_cmd').on(t.commandId),
    userIdx: index('idx_runs_user').on(t.userId),
  }),
)
export type CommandRunRow = typeof commandRuns.$inferSelect

// Phase 8 — key/value settings incl. branding (data model §4). JSON per key, zod-validated.
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
})
export type SettingRow = typeof settings.$inferSelect

// Phase 7 — clips & loops (data model §3). A clip is metadata over a source range.
export const clips = sqliteTable(
  'clips',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // null => orphaned (source deleted); kept rather than cascading the clip away (FR-44).
    sourceItemId: text('source_item_id').references(() => mediaItems.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    startS: real('start_s').notNull(),
    endS: real('end_s').notNull(),
    loop: integer('loop').notNull().default(1),
    posterPath: text('poster_path'),
    exportPath: text('export_path'),
    exportStatus: text('export_status', {
      enum: ['none', 'queued', 'rendering', 'ready', 'failed'],
    })
      .notNull()
      .default('none'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    userIdx: index('idx_clips_user').on(t.userId),
  }),
)
export type ClipRow = typeof clips.$inferSelect

// Phase 4 — per-user resume/watched state (data model §3).
export const playbackProgress = sqliteTable(
  'playback_progress',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaItemId: text('media_item_id')
      .notNull()
      .references(() => mediaItems.id, { onDelete: 'cascade' }),
    positionS: real('position_s').notNull(),
    durationS: real('duration_s'),
    watched: integer('watched').notNull().default(0),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.mediaItemId] }),
  }),
)
export type PlaybackProgressRow = typeof playbackProgress.$inferSelect

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    payload: text('payload').notNull(),
    status: text('status', {
      enum: ['queued', 'running', 'succeeded', 'failed', 'canceled'],
    }).notNull(),
    priority: integer('priority').notNull().default(0),
    progress: real('progress').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
  },
  (t) => ({
    statusIdx: index('idx_jobs_status').on(t.status, t.priority),
  }),
)
export type JobRow = typeof jobs.$inferSelect

// Phase 10 — plugins (docs/13-plugins.md). A plugin is admin-installed code that runs as a
// sandboxed child process behind a mediated Host API. The manifest JSON is the source of truth
// for the plugin's commands/panels/events/permissions; the columns are denormalized for queries.
export const plugins = sqliteTable('plugins', {
  id: text('id').primaryKey(), // the manifest id (reverse-DNS-ish), globally unique
  name: text('name').notNull(),
  version: text('version').notNull(),
  description: text('description'),
  author: text('author'),
  icon: text('icon'), // sanitized inline SVG, or null
  main: text('main').notNull(), // entry module, relative to install_path
  manifest: text('manifest').notNull(), // full manifest JSON (authoritative)
  permissions: text('permissions').notNull().default('[]'), // JSON array of declared permissions
  daemon: integer('daemon').notNull().default(0),
  enabled: integer('enabled').notNull().default(0),
  status: text('status', { enum: ['installed', 'active', 'error', 'disabled'] })
    .notNull()
    .default('installed'),
  lastError: text('last_error'),
  config: text('config').notNull().default('{}'), // admin-set config values (JSON object)
  installPath: text('install_path').notNull(),
  installedBy: text('installed_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})
export type PluginRow = typeof plugins.$inferSelect

// Plugin-scoped key/value persistence (the `storage` Host API).
export const pluginKv = sqliteTable(
  'plugin_kv',
  {
    pluginId: text('plugin_id')
      .notNull()
      .references(() => plugins.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value').notNull(), // JSON
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.pluginId, t.key] }),
  }),
)
export type PluginKvRow = typeof pluginKv.$inferSelect

// Audit log of plugin invocations (commands, events, panel actions, activation).
export const pluginRuns = sqliteTable(
  'plugin_runs',
  {
    id: text('id').primaryKey(),
    pluginId: text('plugin_id')
      .notNull()
      .references(() => plugins.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['command', 'event', 'action', 'activate'] }).notNull(),
    ref: text('ref'), // command id / event name / panel:action
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    input: text('input'), // JSON args/payload
    output: text('output'), // collected logs / result JSON
    error: text('error'),
    status: text('status', { enum: ['queued', 'running', 'succeeded', 'failed', 'timeout'] }).notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    pluginIdx: index('idx_plugin_runs_plugin').on(t.pluginId, t.createdAt),
  }),
)
export type PluginRunRow = typeof pluginRuns.$inferSelect

// Self-update history (changelog). One row per applied package; status transitions
// applying → pending_restart → success (or failed / rolled_back). Code-only updates never
// touch DATA_DIR, so this table — like all data — survives every update.
export const appUpdates = sqliteTable('app_updates', {
  id: text('id').primaryKey(),
  version: text('version').notNull(),
  changelog: text('changelog'),
  status: text('status', {
    enum: ['applying', 'pending_restart', 'success', 'failed', 'rolled_back'],
  }).notNull(),
  appliedAt: integer('applied_at').notNull(),
  note: text('note'),
})
export type AppUpdateRow = typeof appUpdates.$inferSelect
