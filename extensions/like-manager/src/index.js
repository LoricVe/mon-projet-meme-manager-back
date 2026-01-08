export default {
  id: 'like-manager',
  handler: (router, { services, database, getSchema, logger }) => {
    const { ItemsService } = services;

    // POST /like-manager/toggle - Like/Unlike un meme
    router.post('/toggle', async (req, res) => {
      try {
        const { meme_id } = req.body;
        const user_id = req.accountability?.user;

        if (!meme_id || !user_id) {
          return res.status(400).json({
            error: 'meme_id et user_id requis'
        });
          }

        const schema = await getSchema();
        const likesService = new ItemsService('memes_likes', { schema, accountability: req.accountability });
        const memesService = new ItemsService('memes', { schema, accountability: req.accountability });

        // 1. Vérifier si l'utilisateur a déjà liké ce meme
        const existingLikes = await likesService.readByQuery({
          filter: {
            meme_id: { _eq: meme_id },
            user_id: { _eq: user_id }
          }
        });

        let action, message;

        if (existingLikes.length > 0) {
          // UNLIKE : L'utilisateur retire son like
          await likesService.deleteOne(existingLikes[0].id);

          // Décrémenter le compteur de likes dans le meme
          await memesService.updateOne(meme_id, {
            likes: {
              _inc: -1  // Décrémenter de 1
            }
          });

          action = 'unliked';
          message = 'Like retiré avec succès';

        } else {
          // LIKE : L'utilisateur ajoute son like
          await likesService.createOne({
            meme_id,
            user_id
          });

          // Incrémenter le compteur de likes dans le meme
          await memesService.updateOne(meme_id, {
            likes: {
              _inc: 1  // Incrémenter de 1
            }
          });

          action = 'liked';
          message = 'Meme liké avec succès';
        }

        // 2. Récupérer les données du meme mis à jour
        const updatedMeme = await memesService.readOne(meme_id, {
          fields: ['*', 'user_created.first_name', 'user_created.last_name']
        });

        // 3. Récupérer les infos de l'utilisateur qui like
        const currentUser = await new ItemsService('directus_users', { schema, accountability: req.accountability })
          .readOne(user_id, { fields: ['first_name', 'last_name', 'email'] });

        // 4. Envoyer notification WebSocket personnalisée
        if (req.services?.websocket) {
          req.services.websocket.broadcast('like_notification', {
            type: 'like_event',
            action: action,
            meme: {
              id: updatedMeme.id,
              title: updatedMeme.title,
              likes: updatedMeme.likes,
              author: updatedMeme.user_created
            },
            user: {
              name: `${currentUser.first_name} ${currentUser.last_name}`,
              email: currentUser.email
            },
            timestamp: new Date().toISOString()
          });
        }

        res.json({
          success: true,
          action,
          message,
          data: {
            meme_id,
            user_id,
            likes_count: updatedMeme.likes,
            user_has_liked: action === 'liked'
          }
          });

      } catch (error) {
        logger.error('Erreur dans like-manager:', error);
        res.status(500).json({
          error: 'Erreur interne du serveur',
          details: error.message
        });
      }
    });

    // GET /like-manager/status/:meme_id - Vérifier le statut de like d'un meme
    router.get('/status/:meme_id', async (req, res) => {
      try {
        const { meme_id } = req.params;
        const user_id = req.accountability?.user;

        if (!user_id) {
          return res.status(401).json({ error: 'Authentification requise' });
        }

        const schema = await getSchema();
        const likesService = new ItemsService('memes_likes', { schema, accountability: req.accountability });
        const memesService = new ItemsService('memes', { schema, accountability: req.accountability });

        // Vérifier si l'user a liké ce meme
        const existingLikes = await likesService.readByQuery({
          filter: {
            meme_id: { _eq: meme_id },
            user_id: { _eq: user_id }
          }
        });

        // Récupérer le nombre total de likes
        const meme = await memesService.readOne(meme_id, {
          fields: ['likes']
        });

        res.json({
          meme_id,
          user_has_liked: existingLikes.length > 0,
          total_likes: meme.likes || 0
        });

      } catch (error) {
        logger.error('Erreur status like-manager:', error);
        res.status(500).json({
          error: 'Erreur interne du serveur',
          details: error.message
        });
      }
    });
  },
};