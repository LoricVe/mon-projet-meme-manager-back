const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const db = new sqlite3.Database('./data.db');

let schemaSql = '';
let fullDump = '';

// Récupérer toutes les tables
db.all("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name", (err, tables) => {
    if (err) {
        console.error('Erreur:', err);
        return;
    }

    let pending = tables.length;

    tables.forEach(table => {
        // Ajouter le schema
        if (table.sql) {
            schemaSql += table.sql + ';\n\n';
            fullDump += table.sql + ';\n\n';
        }

        // Récupérer les données
        db.all(`SELECT * FROM "${table.name}"`, (err, rows) => {
            if (err) {
                console.error(`Erreur table ${table.name}:`, err);
                pending--;
                return;
            }

            if (rows.length > 0) {
                rows.forEach(row => {
                    const columns = Object.keys(row).map(c => `"${c}"`).join(', ');
                    const values = Object.values(row).map(v => {
                        if (v === null) return 'NULL';
                        if (typeof v === 'number') return v;
                        if (typeof v === 'boolean') return v ? 1 : 0;
                        return `'${String(v).replace(/'/g, "''")}'`;
                    }).join(', ');
                    fullDump += `INSERT INTO "${table.name}" (${columns}) VALUES (${values});\n`;
                });
                fullDump += '\n';
            }

            pending--;
            if (pending === 0) {
                // Écrire les fichiers
                fs.writeFileSync('schema.sql', schemaSql);
                fs.writeFileSync('directus_backup.sql', fullDump);
                console.log('✅ Fichiers générés:');
                console.log('   - schema.sql (structure uniquement)');
                console.log('   - directus_backup.sql (structure + données)');
                db.close();
            }
        });
    });
});
