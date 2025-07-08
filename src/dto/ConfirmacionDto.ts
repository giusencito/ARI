export class ConfirmacionDto {
  success: boolean;
  audio: Buffer;
  placa: string;
}
export class TypeConfirmacionDTO extends ConfirmacionDto {
  type: string;
}
