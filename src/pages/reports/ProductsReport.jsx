import ReportTable from "./ReportTable.jsx";

export default function ProductsReport({ products }) {
  return (
    <ReportTable
      title="Top products"
      exportName="products"
      headers={["Product", "SKU", "Sold", "Returns", "Net sales"]}
      rows={products.slice(0, 10).map((product) => [
        product.product,
        product.sku,
        product.quantitySold,
        product.returns,
        `£${Number(product.netSales).toFixed(2)}`,
      ])}
    />
  );
}
