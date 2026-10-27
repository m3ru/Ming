import * as board from '../board.mjs';
import { startServer } from '../server.mjs';

let server;
process.on('message', async ({ id, action, args = [] }) => {
    try {
        let result;
        if (action === 'start') {
            server = await startServer();
            result = server.url;
        } else if (action === 'close') {
            await server.close();
            result = board.events.listenerCount('changed');
        } else if (action === 'batch') {
            const [componentId, prefix, count] = args;
            result = await Promise.all(Array.from({ length: count }, (_, index) =>
                board.addTask(componentId, `${prefix}-${index}`)));
        } else if (action === 'statuses') {
            const current = board.withStatus(await board.getBoard());
            result = Object.fromEntries(current.components.flatMap((c) => c.tasks).map((t) => [t.id, t.status]));
        } else {
            result = await board[action](...args);
        }
        process.send({ id, result });
    } catch (error) {
        process.send({ id, error: error.message });
    }
});
process.send({ ready: true });
