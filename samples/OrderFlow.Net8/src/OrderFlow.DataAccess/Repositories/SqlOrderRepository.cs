using System.Data;
using OrderFlow.Contracts.Interfaces;
using OrderFlow.Contracts.Models;

namespace OrderFlow.DataAccess.Repositories;

public sealed class SqlOrderRepository : IOrderRepository
{
    private readonly string _connectionString;

    public SqlOrderRepository(string connectionString)
    {
        _connectionString = connectionString ?? throw new ArgumentNullException(nameof(connectionString));
    }

    public async Task<OrderDto?> GetByIdAsync(Guid orderId, CancellationToken cancellationToken = default)
    {
        await Task.Delay(5, cancellationToken);
        return null;
    }

    public async Task<IReadOnlyList<OrderDto>> GetByCustomerAsync(Guid customerId, CancellationToken cancellationToken = default)
    {
        await Task.Delay(5, cancellationToken);
        return Array.Empty<OrderDto>();
    }

    public async Task SaveAsync(OrderDto order, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(order);
        await Task.Delay(5, cancellationToken);
    }
}

public sealed class SqlCustomerRepository : ICustomerRepository
{
    private readonly string _connectionString;

    public SqlCustomerRepository(string connectionString)
    {
        _connectionString = connectionString ?? throw new ArgumentNullException(nameof(connectionString));
    }

    public async Task<CustomerDto?> GetCustomerByIdAsync(Guid customerId, CancellationToken cancellationToken = default)
    {
        await Task.Delay(5, cancellationToken);
        return null;
    }
}
