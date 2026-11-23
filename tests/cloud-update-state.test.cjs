const {test}=require('node:test');
const assert=require('node:assert/strict');
const {environment}=require('./fixtures.cjs');
const {
  acquireCloudUpdate, applyCloudUpdateMigrations, readCloudUpdate, setCloudUpdatePhase
}=require('../.test-build/src/cloud-update-state.js');

function createLedger(sqlite){
  sqlite.exec(`
    CREATE TABLE d1_migrations(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    INSERT INTO d1_migrations(name) VALUES('0029_mcp_key_fingerprint.sql');
  `);
}

test('Cloud updates share the Wrangler migration ledger and retry a partially applied release',async()=>{
  const {DB,sqlite}=environment();
  try{
    createLedger(sqlite);
    const first={name:'0031_update_test.sql',statements:[
      'CREATE TABLE update_test(value INTEGER NOT NULL)',
      'CREATE TABLE update_test_input(value INTEGER NOT NULL)',
      'INSERT INTO update_test_input(value) VALUES(-1)',
      'CREATE TRIGGER update_test_guard BEFORE INSERT ON update_test WHEN NEW.value < 0 BEGIN SELECT RAISE(ABORT,\'negative\'); END;'
    ]};
    const second={name:'0032_update_test_more.sql',statements:[
      'ALTER TABLE update_test ADD COLUMN label TEXT',
      "INSERT INTO update_test(value,label) SELECT value,'test' FROM update_test_input"
    ]};
    assert.equal(await acquireCloudUpdate(DB,'0.21.0','first'),true);
    assert.equal(await acquireCloudUpdate(DB,'0.21.0','concurrent'),false);
    await assert.rejects(applyCloudUpdateMigrations(DB,'first',[second,first]),/negative/);
    assert.deepEqual(sqlite.prepare('SELECT name FROM d1_migrations ORDER BY id').all().map(row=>row.name),[
      '0029_mcp_key_fingerprint.sql','0031_update_test.sql'
    ]);
    assert.deepEqual(sqlite.prepare("PRAGMA table_info('update_test')").all().map(row=>row.name),['value']);
    await setCloudUpdatePhase(DB,'first','failed','A migration failed.');
    assert.equal((await readCloudUpdate(DB)).phase,'failed');

    sqlite.exec('UPDATE update_test_input SET value=1');
    assert.equal(await acquireCloudUpdate(DB,'0.21.0','retry'),true);
    await applyCloudUpdateMigrations(DB,'retry',[first,second]);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS applied FROM d1_migrations WHERE name='0032_update_test_more.sql'").get()?.applied,1);
    assert.equal(sqlite.prepare('SELECT label FROM update_test').get()?.label,'test');
    await setCloudUpdatePhase(DB,'retry','verifying');
    await setCloudUpdatePhase(DB,'retry','succeeded');
    assert.equal((await readCloudUpdate(DB)).expires,0);
  }finally{sqlite.close();}
});

test('Losing the Cloud update lease before a migration batch prevents schema changes',async()=>{
  const {DB,sqlite}=environment();
  try{
    createLedger(sqlite);
    assert.equal(await acquireCloudUpdate(DB,'0.21.0','first'),true);
    const batch=DB.batch.bind(DB);
    DB.batch=async statements=>{
      sqlite.exec("UPDATE settings SET value=json_set(value,'$.expires',0) WHERE key='cloud_update'");
      assert.equal(await acquireCloudUpdate(DB,'0.21.0','replacement'),true);
      return batch(statements);
    };
    await assert.rejects(applyCloudUpdateMigrations(DB,'first',[{
      name:'0031_expired_test.sql',statements:['CREATE TABLE expired_test(id INTEGER)']
    }]),/NOT NULL/);
    assert.equal(sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE name='expired_test'").get(),undefined);
    assert.equal((await readCloudUpdate(DB)).owner,'replacement');
  }finally{sqlite.close();}
});
