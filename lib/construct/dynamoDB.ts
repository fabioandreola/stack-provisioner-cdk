import { AttributeType, BillingMode, Table } from "@aws-cdk/aws-dynamodb";
import { Construct, RemovalPolicy } from "@aws-cdk/core";

export interface TableProperties {

}

export class DetailsTableStack extends Construct {

    public readonly table: Table;

    constructor(scope: Construct, id: string, props: TableProperties) {
      super(scope,id);

      this.table = new Table(this, 'StackDetailsTable', {
        partitionKey: {
          name: 'id',
          type: AttributeType.STRING
        },
        billingMode: BillingMode.PAY_PER_REQUEST,
        removalPolicy: RemovalPolicy.DESTROY,
        tableName: "StackDetailsTable"
      });
    }
}
