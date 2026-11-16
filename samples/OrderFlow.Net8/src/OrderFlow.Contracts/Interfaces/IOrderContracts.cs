using OrderFlow.Contracts.Models;

namespace OrderFlow.Contracts.Interfaces;

public interface IOrderRepository
{
    Task<OrderDto?> GetByIdAsync(Guid orderId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<OrderDto>> GetByCustomerAsync(Guid customerId, CancellationToken cancellationToken = default);
    Task SaveAsync(OrderDto order, CancellationToken cancellationToken = default);
}

public interface ICustomerRepository
{
    Task<CustomerDto?> GetCustomerByIdAsync(Guid customerId, CancellationToken cancellationToken = default);
}

public interface IOrderService
{
    Task<OrderDto> CreateOrderAsync(CreateOrderRequest request, CancellationToken cancellationToken = default);
    Task<OrderDto?> GetOrderSummaryAsync(Guid orderId, CancellationToken cancellationToken = default);
}
