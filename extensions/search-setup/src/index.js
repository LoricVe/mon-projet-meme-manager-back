import { MeiliSearch } from 'meilisearch';

export default (router, context) => {
  const { env, services, exceptions, database, getSchema } = context;

  // Vérification des services disponibles
  if (!services) {
    console.error('Services non disponibles');
    throw new Error('Services non disponibles');
  }

  // Debug: afficher la structure des services et du contexte
  console.log('Services disponibles:', Object.keys(services || {}));
  console.log('Context keys:', Object.keys(context || {}));
  console.log('Database disponible:', !!database);

  // Gérer le cas où ServiceUnavailableException n'est pas disponible
  const ServiceUnavailableException = exceptions?.ServiceUnavailableException || class extends Error {
    constructor(message) {
      super(message);
      this.name = 'ServiceUnavailableException';
      this.status = 503;
    }
  };

  const client = new MeiliSearch({
    host: env.MEILISEARCH_HOST || 'http://localhost:7700',
    apiKey: env.MEILISEARCH_API_KEY
  });

  const indexName = `${env.MEILISEARCH_INDEX_PREFIX || 'directus_'}memes`;

  // Endpoint de configuration initiale
  router.post('/meilisearch', async (req, res) => {
    try {
      const index = client.index(indexName);

      // 1. Configuration des attributs de recherche
      await index.updateSearchableAttributes([
        'title',
        'searchable_content',
        'tags',
        'creator'
      ]);

      // 2. Configuration des filtres disponibles
      await index.updateFilterableAttributes([
        'tags',
        'creator_id',
        'date_created'
      ]);

      // 3. Configuration du tri
      await index.updateSortableAttributes([
        'likes',
        'views',
        'date_created'
      ]);

      // 4. Configuration des synonymes (optionnel)
      await index.updateSynonyms({
        'drole': ['amusant', 'marrant', 'comique'],
        'bug': ['erreur', 'bogue', 'probleme'],
        'dev': ['developpeur', 'programmeur', 'codeur']
      });

      // 5. Import des memes existants
      const { ItemsService } = services;

      // Debug: vérifier la structure des services
      console.log('ItemsService disponible:', !!ItemsService);
      console.log('Type de services:', typeof services);

      // Vérification des services nécessaires
      if (!ItemsService) {
        console.error('Services structure:', services);
        throw new Error('ItemsService non disponible dans services');
      }

      // Récupérer le schéma si getSchema est disponible
      const schema = getSchema ? await getSchema() : req.schema;

      const memesService = new ItemsService('memes', {
        accountability: req.accountability,
        schema: schema,
        knex: database
      });

      const existingMemes = await memesService.readByQuery({
        fields: [
          '*',
          'user_created.id',
          'user_created.first_name',
          'user_created.last_name',
          'tags.tags_id.id',
          'tags.tags_id.name'
        ]
      });

      // 6. Transformation des données pour Meilisearch
      const documents = existingMemes.map(meme => ({
        id: meme.id,
        title: meme.title || '',
        searchable_content: `${meme.title || ''}`,
        tags: meme.tags?.map(tag => tag.tags_id?.name).filter(Boolean) || [],
        creator: `${meme.user_created?.first_name || ''} ${meme.user_created?.last_name || ''}`.trim(),
        creator_id: meme.user_created?.id,
        likes: parseInt(meme.likes) || 0,
        views: parseInt(meme.views) || 0,
        date_created: meme.date_created,
        collection: 'memes'
      }));

      // 7. Ajout des documents à l'index
      if (documents.length > 0) {
        const task = await index.addDocuments(documents);

        res.json({
          success: true,
          message: 'Index Meilisearch configuré avec succès',
          indexName: indexName,
          documentsCount: documents.length,
          taskId: task.taskUid,
          configuration: {
            searchableAttributes: ['title', 'searchable_content', 'tags', 'creator'],
            filterableAttributes: ['tags', 'creator_id', 'date_created'],
            sortableAttributes: ['likes', 'views', 'date_created']
          }
        });
      } else {
        res.json({
          success: true,
          message: 'Index configuré mais aucun meme trouvé',
          indexName: indexName,
          documentsCount: 0
        });
      }

    } catch (error) {
      console.error('Erreur configuration Meilisearch:', error);
      throw new ServiceUnavailableException(`Erreur configuration Meilisearch: ${error.message}`);
    }
  });

  // Endpoint de vérification de l'état
  router.get('/meilisearch/status', async (req, res) => {
    try {
      const health = await client.health();
      const index = client.index(indexName);
      const stats = await index.getStats();

      res.json({
        meilisearch: {
          status: health.status,
          host: env.MEILISEARCH_HOST
        },
        index: {
          name: indexName,
          documentsCount: stats.numberOfDocuments,
          isIndexing: stats.isIndexing,
          lastUpdate: stats.lastUpdate
        }
      });
    } catch (error) {
      res.status(500).json({
        error: 'Impossible de se connecter à Meilisearch',
        details: error.message
      });
    }
  });
};