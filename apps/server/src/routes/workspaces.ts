import type { FastifyPluginAsync } from "fastify";
import {
  addWorkspaceBookRequestSchema,
  addWorkspaceSourceRequestSchema,
  createWorkspaceRequestSchema,
  updateWorkspaceRequestSchema,
} from "@lensmap/shared";
import type { WorkspaceService } from "../workspaces/workspace-service.js";

export interface WorkspaceRoutesOptions {
  workspaceService: WorkspaceService;
}

/** Expose workspace ownership independently from any Chrome tab. */
export const workspaceRoutes: FastifyPluginAsync<WorkspaceRoutesOptions> = async (app, options) => {
  app.get("/", async () => ({ workspaces: options.workspaceService.list() }));

  app.post("/", async (request, reply) => {
    const parsed = createWorkspaceRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.message });
    try {
      return reply.code(201).send(options.workspaceService.create(parsed.data));
    } catch (error) {
      return reply.code(400).send({ message: messageOf(error) });
    }
  });

  app.get<{ Params: { workspaceId: string } }>("/:workspaceId", async (request, reply) => {
    try {
      return options.workspaceService.get(request.params.workspaceId);
    } catch (error) {
      return reply.code(404).send({ message: messageOf(error) });
    }
  });

  app.patch<{ Params: { workspaceId: string } }>("/:workspaceId", async (request, reply) => {
    const parsed = updateWorkspaceRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.message });
    try {
      return options.workspaceService.rename(request.params.workspaceId, parsed.data.name);
    } catch (error) {
      return reply.code(404).send({ message: messageOf(error) });
    }
  });

  app.post<{ Params: { workspaceId: string } }>("/:workspaceId/books", async (request, reply) => {
    const parsed = addWorkspaceBookRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.message });
    try {
      return options.workspaceService.addBook(request.params.workspaceId, parsed.data.bookId);
    } catch (error) {
      return reply.code(400).send({ message: messageOf(error) });
    }
  });

  app.post<{ Params: { workspaceId: string } }>("/:workspaceId/sources", async (request, reply) => {
    const parsed = addWorkspaceSourceRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.message });
    try {
      return options.workspaceService.addSource(request.params.workspaceId, parsed.data.sourceAnchorId);
    } catch (error) {
      return reply.code(400).send({ message: messageOf(error) });
    }
  });

  app.delete<{ Params: { workspaceId: string; sourceAnchorId: string } }>("/:workspaceId/sources/:sourceAnchorId", async (request, reply) => {
    try {
      return options.workspaceService.removeSource(request.params.workspaceId, request.params.sourceAnchorId);
    } catch (error) {
      return reply.code(404).send({ message: messageOf(error) });
    }
  });
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
