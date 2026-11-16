using Microsoft.AspNetCore.Mvc;
using OrderFlow.Contracts.Interfaces;
using OrderFlow.Contracts.Models;
using OrderFlow.DataAccess.Repositories;

namespace OrderFlow.API.Controllers;

[ApiController]
[Route("api/orders")]
public sealed class OrdersController : ControllerBase
{
    private readonly IOrderService _orderService;
    private readonly SqlOrderRepository _directRepository;

    public OrdersController(IOrderService orderService, SqlOrderRepository directRepository)
    {
        _orderService = orderService;
        _directRepository = directRepository;
    }

    [HttpGet("{orderId:guid}")]
    public async Task<ActionResult<OrderDto>> GetOrder(Guid orderId, CancellationToken cancellationToken)
    {
        var order = await _orderService.GetOrderSummaryAsync(orderId, cancellationToken);
        if (order is null)
        {
            return NotFound();
        }
        return Ok(order);
    }

    [HttpGet("customer/{customerId:guid}")]
    public ActionResult<IReadOnlyList<OrderDto>> GetCustomerOrders(Guid customerId)
    {
        // Architectural violation: Controller bypasses BusinessLogic and blocks on .Result
        var orders = _directRepository.GetByCustomerAsync(customerId).Result;
        return Ok(orders);
    }

    [HttpPost]
    public async Task<ActionResult<OrderDto>> CreateOrder([FromBody] CreateOrderRequest request, CancellationToken cancellationToken)
    {
        var created = await _orderService.CreateOrderAsync(request, cancellationToken);
        return CreatedAtAction(nameof(GetOrder), new { orderId = created.Id }, created);
    }
}
