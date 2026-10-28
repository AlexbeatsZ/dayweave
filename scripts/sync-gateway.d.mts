import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export function createGateway(options?: {
  port?: number;
  subscriptionPort?: number;
  syncPort?: number;
}): {
  server: Server;
  listen(): Promise<AddressInfo>;
};
