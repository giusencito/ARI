export class ApiResponseProxyDTO<T> {
  success: boolean;
  statusCode: number;
  url: string;
  element?: T;
}
