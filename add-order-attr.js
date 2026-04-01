const sdk = require('node-appwrite');

const client = new sdk.Client()
    .setEndpoint('https://sgp.cloud.appwrite.io/v1')
    .setProject('69ca6dd30013a519ec48')
    .setKey('standard_fa6edc6cc9bedfb43dfc66765bd9dba98211f1d96ca6f1320e679d7f345941bafe904d52c172586aa41590db7a00ce4c8d94010546d142a0179f9995390f381daac3fc4a3012e53b1fcb4c5074b8728796483f1903026d202df60fa0c931b749480325bc10ff6c44e553f1a3d7d667eb99c3ec8e05fb169ab9bb2626a126a030');

const databases = new sdk.Databases(client);

async function addOrderAttribute() {
    try {
        console.log('--- Adding "order" attribute to "accounts" collection ---');
        await databases.createIntegerAttribute(
            'ledger-db',
            'accounts',
            'order',
            false,  // required
            0,      // min
            99999,  // max
            0       // default
        );
        console.log('✅ "order" attribute created successfully!');
    } catch (e) {
        if (e.code === 409) {
            console.log('ℹ️ "order" attribute already exists.');
        } else {
            console.error('❌ Error adding attribute:', e.message);
        }
    }
}

addOrderAttribute();
