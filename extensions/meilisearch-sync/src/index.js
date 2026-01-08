import { MeiliSearch } from 'meilisearch';

export default ({ action }, { env, services, logger }) => {
  // Configuration du client Meilisearch
  const client = new MeiliSearch({
    host: env.MEILISEARCH_HOST || 'http://localhost:7700',
    apiKey: env.MEILISEARCH_API_KEY
  });

  const indexName = `${env.MEILISEARCH_INDEX_PREFIX || 'directus_'}memes`;
  const index = client.index(indexName);

  // Fonction utilitaire pour transformer un meme pour Meilisearch
  async function transformMemeForSearch(memeId, services) {
    try {
      const { ItemsService } = services;
      const memesService = new ItemsService('memes', {
        knex: services.knex,
        schema: services.schema
      });

      const meme = await memesService.readOne(memeId, {
        fields: [
          '*',
          'user_created.id',
          'user_created.first_name',
          'user_created.last_name',
          'tags.tags_id.id',
          'tags.tags_id.name'
        ]
      });

      if (!meme || meme.status !== 'published') {
        return null; // Ne pas indexer les memes non publiés
      }

      return {
        id: meme.id,
        title: meme.title || '',
        searchable_content: `${meme.title || ''} ${meme.description || ''}`,
        tags: meme.tags?.map(tag => tag.tags_id?.name).filter(Boolean) || [],
        creator: `${meme.user_created?.first_name || ''} ${meme.user_created?.last_name || ''}`.trim(),
        creator_id: meme.user_created?.id,
        likes: parseInt(meme.likes) || 0,
        views: parseInt(meme.views) || 0,
        status: meme.status,
        date_created: meme.date_created,
        collection: 'memes'
      };
    } catch (error) {
      logger.error(`Erreur transformation meme ${memeId}:`, error.message);
      return null;
    }
  }

  // Hook CREATE : Nouveau meme créé
  action('memes.items.create', async ({ key, payload }) => {
    try {
      if (payload.status === 'published') {
        const document = await transformMemeForSearch(key, services);
        if (document) {
          await index.addDocuments([document]);
          logger.info(`Meme ${key} ajouté à l'index Meilisearch`);
        }
      }
    } catch (error) {
      logger.error(`Erreur sync CREATE meme ${key}:`, error.message);
    }
  });

  // Hook UPDATE : Meme modifié
  action('memes.items.update', async ({ keys, payload }) => {
    try {
      for (const key of keys) {
        const document = await transformMemeForSearch(key, services);
        if (document) {
          // Meme publié : mettre à jour dans l'index
          await index.updateDocuments([document]);
          logger.info(`Meme ${key} mis à jour dans Meilisearch`);
        } else {
          // Meme dépublié : supprimer de l'index
          await index.deleteDocument(key);
          logger.info(`Meme ${key} supprimé de l'index Meilisearch`);
        }
      }
    } catch (error) {
      logger.error(`Erreur sync UPDATE memes:`, error.message);
    }
  });

  // Hook DELETE : Meme supprimé
  action('memes.items.delete', async ({ keys }) => {
    try {
      await index.deleteDocuments(keys);
      logger.info(`Memes ${keys.join(', ')} supprimés de Meilisearch`);
    } catch (error) {
      logger.error(`Erreur sync DELETE memes:`, error.message);
    }
  });

  logger.info('Hook Meilisearch initialisé pour la collection memes');
};