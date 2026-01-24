declare module "snarkjs" {
  export interface Groth16Proof {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
    curve: string;
  }

  export interface Groth16 {
    fullProve(
      input: Record<string, any>,
      wasmFile: string,
      zkeyFile: string
    ): Promise<{
      proof: Groth16Proof;
      publicSignals: string[];
    }>;

    verify(
      vkey: any,
      publicSignals: string[],
      proof: Groth16Proof
    ): Promise<boolean>;

    exportSolidityCallData(
      proof: Groth16Proof,
      publicSignals: string[]
    ): Promise<string>;
  }

  export const groth16: Groth16;
}
