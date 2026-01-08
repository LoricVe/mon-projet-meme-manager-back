import { MeiliSearch } from 'meilisearch';

export default (router, { env, services, exceptions }) => {
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

  // Endpoint de recherche principal
  router.get('/memes', async (req, res) => {
    try {
      // Vérification de la connexion Meilisearch
      const health = await client.health();
      if (health.status !== 'available') {
        throw new Error('Meilisearch non disponible');
      }

      const index = client.index(indexName);

      // Vérification de l'existence de l'index
      try {
        await index.getStats();
      } catch (error) {
        if (error.code === 'index_not_found') {
          return res.status(500).json({
            error: 'Index non configuré',
            message: 'Appelez POST /search-setup/meilisearch pour initialiser l\'index'
          });
        }
        throw error;
      }

      const { q, limit = 20, offset = 0, tags, creator, sort } = req.query;

      const searchOptions = {
        limit: parseInt(limit),
        offset: parseInt(offset),
        attributesToRetrieve: ['*'],
        attributesToHighlight: ['title', 'searchable_content'],
        highlightPreTag: '',
        highlightPostTag: '',
        attributesToCrop: ['searchable_content'],
        cropLength: 100
      };

      // Construction des filtres
      const filters = [];
      if (tags) {
        const tagList = Array.isArray(tags) ? tags : [tags];
        // CORRECTION : syntaxe correcte sans espaces
        filters.push(`tags IN [${tagList.map(t => `"${t}"`).join(',')}]`);
      }
      if (creator) {
        filters.push(`creator_id = "${creator}"`);
      }

      if (filters.length > 0) {
        searchOptions.filter = filters.join(' AND ');
      }

      // Gestion du tri
      if (sort) {
        const sortOptions = [];
        sort.split(',').forEach(s => {
          if (s.endsWith('_asc')) {
            sortOptions.push(s.replace('_asc', ':asc'));
          } else if (s.endsWith('_desc')) {
            sortOptions.push(s.replace('_desc', ':desc'));
          }
        });
        if (sortOptions.length > 0) {
          searchOptions.sort = sortOptions;
        }
      }

      // Exécution de la recherche
      const results = await index.search(q || '', searchOptions);

      res.json({
        hits: results.hits,
        query: q,
        totalHits: results.estimatedTotalHits,
        processingTimeMs: results.processingTimeMs,
        facetDistribution: results.facetDistribution,
        pagination: {
          offset: parseInt(offset),
          limit: parseInt(limit),
          hasNext: results.hits.length === parseInt(limit)
        }
      });

    } catch (error) {
      console.error('Erreur recherche Meilisearch:', error);
      throw new ServiceUnavailableException(`Erreur de recherche: ${error.message}`);
    }
  });

  // Endpoint de suggestions d'autocomplétion
  router.get('/memes/suggest', async (req, res) => {
    try {
      const { q, limit = 5 } = req.query;
      if (!q) {
        return res.json({ suggestions: [] });
      }

      const index = client.index(indexName);
      const results = await index.search(q, {
        limit: parseInt(limit),
        attributesToRetrieve: ['id', 'title'],
        attributesToHighlight: ['title'],
        highlightPreTag: '',
        highlightPostTag: ''
      });

      res.json({
        suggestions: results.hits.map(hit => ({
          id: hit.id,
          title: hit.title,
          highlighted: hit._formatted?.title || hit.title
        }))
      });

    } catch (error) {
      throw new ServiceUnavailableException(`Erreur suggestions: ${error.message}`);
    }
  });
};