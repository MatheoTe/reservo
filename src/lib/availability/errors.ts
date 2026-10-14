export class AvailabilityInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvailabilityInputError";
  }
}
